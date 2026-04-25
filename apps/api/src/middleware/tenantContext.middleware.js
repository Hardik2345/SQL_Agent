import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { tenantClient } from '../modules/tenant/tenantClient.js';
import { childLogger } from '../utils/logger.js';
import { newCorrelationId } from '../utils/helpers.js';
import { GatewayAuthError, TenantRouterError } from '../utils/errors.js';

/** Headers the gateway injects after JWT verification. */
const H_BRAND = 'x-brand-id';
const H_USER = 'x-user-id';
const H_ROLE = 'x-role';
const H_EMAIL = 'x-email';
const H_PERMS = 'x-permissions';
const H_GW_TS = 'x-gw-ts';
const H_GW_SIG = 'x-gw-sig';
const H_CORRELATION = 'x-correlation-id';

/** Max clock skew tolerated on the x-gw-ts timestamp (seconds). */
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

const headerValue = (req, name) => {
  const raw = req.headers[name];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

/**
 * Verify the gateway HMAC. Payload format (see api-gateway/gateway/lua/auth.lua:301-306):
 *   HMAC-SHA256( `${sub}|${brand_id}|${role}|${ts}`, GATEWAY_SHARED_SECRET )
 * encoded as hex.
 *
 * @param {{ userId: string, brandId: string, role: string, ts: string, sig: string }} claim
 * @param {string} secret
 * @returns {{ ok: boolean, reason?: string }}
 */
const verifyGatewaySignature = (claim, secret) => {
  const { userId, brandId, role, ts, sig } = claim;
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_SIGNATURE_AGE_SECONDS) {
    return { ok: false, reason: 'signature_expired' };
  }

  const payload = `${userId}|${brandId}|${role}|${ts}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  let provided;
  try {
    provided = Buffer.from(sig, 'hex');
  } catch {
    return { ok: false, reason: 'invalid_signature_encoding' };
  }
  const expectedBuf = Buffer.from(expected, 'hex');
  if (provided.length !== expectedBuf.length) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return timingSafeEqual(provided, expectedBuf)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
};

/**
 * Express middleware that establishes the request-scoped tenant context.
 *
 * Trust model (when GATEWAY_SHARED_SECRET is configured):
 *   - The service only trusts `x-brand-id` that arrived with a valid
 *     `x-gw-sig` / `x-gw-ts` pair signed by the gateway.
 *   - Any request missing the signature (or with an invalid / expired
 *     signature) is rejected with 401 E_GATEWAY_AUTH.
 *   - Clients cannot pass `brandId` via the request body — that field is
 *     ignored even if present, because the body is unsigned.
 *
 * Dev bypass:
 *   - When GATEWAY_SHARED_SECRET is unset AND GATEWAY_TRUST_BYPASS=true,
 *     the middleware accepts `x-brand-id` verbatim without signature
 *     verification. This exists only for local development without the
 *     full gateway stack; it logs a loud warning on every request.
 *
 * Outputs on req:
 *   req.correlationId  — UUID, reused from x-correlation-id when present
 *   req.log            — child logger bound to correlationId + brandId
 *   req.brandId        — verified brand id from the gateway
 *   req.userId         — verified caller user id (optional, may be null)
 *   req.role           — verified caller role (optional)
 *   req.permissions    — string[] from x-permissions
 *   req.tenant         — normalized TenantExecutionContext
 */
export const tenantContextMiddleware = async (req, res, next) => {
  const correlationId = headerValue(req, H_CORRELATION) ?? newCorrelationId();
  req.correlationId = correlationId;
  req.log = childLogger({ correlationId });
  res.setHeader(H_CORRELATION, correlationId);

  const brandIdHeader = headerValue(req, H_BRAND);
  const userId = headerValue(req, H_USER);
  const role = headerValue(req, H_ROLE);
  const email = headerValue(req, H_EMAIL);
  const permsHeader = headerValue(req, H_PERMS);
  const gwTs = headerValue(req, H_GW_TS);
  const gwSig = headerValue(req, H_GW_SIG);

  const secret = env.gateway.sharedSecret;
  const bypass = env.gateway.trustBypass;

  if (secret) {
    if (!brandIdHeader || !userId || !role || !gwTs || !gwSig) {
      req.log.warn(
        {
          event: 'middleware.gateway.missing_headers',
          hasBrand: Boolean(brandIdHeader),
          hasUser: Boolean(userId),
          hasRole: Boolean(role),
          hasTs: Boolean(gwTs),
          hasSig: Boolean(gwSig),
        },
        'missing gateway-signed headers',
      );
      return res.status(401).json({
        ok: false,
        correlationId,
        error: {
          code: 'E_GATEWAY_AUTH',
          message: 'request is not authenticated by the gateway',
        },
      });
    }

    const verification = verifyGatewaySignature(
      { userId, brandId: brandIdHeader, role, ts: gwTs, sig: gwSig },
      secret,
    );
    if (!verification.ok) {
      req.log.warn(
        { event: 'middleware.gateway.bad_signature', reason: verification.reason },
        'gateway signature verification failed',
      );
      return res.status(401).json({
        ok: false,
        correlationId,
        error: {
          code: 'E_GATEWAY_AUTH',
          message: 'gateway signature is invalid or expired',
          details: { reason: verification.reason },
        },
      });
    }
  } else if (!bypass) {
    req.log.error(
      { event: 'middleware.gateway.no_secret' },
      'GATEWAY_SHARED_SECRET is not set and GATEWAY_TRUST_BYPASS is not enabled — rejecting',
    );
    throw new GatewayAuthError(
      'service is misconfigured: no GATEWAY_SHARED_SECRET and no bypass',
    );
  } else {
    req.log.warn(
      { event: 'middleware.gateway.bypass', brandId: brandIdHeader },
      'GATEWAY_TRUST_BYPASS enabled — trusting x-brand-id without signature (dev mode)',
    );
  }

  if (!brandIdHeader) {
    return res.status(400).json({
      ok: false,
      correlationId,
      error: {
        code: 'E_MISSING_BRAND_ID',
        message: 'x-brand-id header is required',
      },
    });
  }

  req.brandId = brandIdHeader;
  req.userId = userId;
  req.role = role;
  req.email = email;
  req.permissions = permsHeader ? permsHeader.split(',').filter(Boolean) : [];
  req.log = childLogger({ correlationId, brandId: brandIdHeader, userId });

  try {
    req.tenant = await tenantClient.resolve(brandIdHeader, { correlationId });
    return next();
  } catch (err) {
    const appErr =
      err instanceof TenantRouterError
        ? err
        : new TenantRouterError('Unexpected tenant resolution error', { cause: err });
    req.log.warn(
      {
        event: 'middleware.tenant.resolution_failed',
        code: appErr.code,
        status: appErr.status,
        brandId: brandIdHeader,
      },
      'tenant resolution failed',
    );
    return res.status(appErr.status).json({
      ok: false,
      correlationId,
      error: {
        code: appErr.code,
        message: appErr.message,
        details: appErr.details,
      },
    });
  }
};
