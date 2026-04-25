import { request } from 'undici';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  TenantNotFoundError,
  TenantRouterError,
  TenantSuspendedError,
  TenantUnavailableError,
} from '../../utils/errors.js';
import {
  assertTenantResolveResponse,
  normalizeTenantResponse,
} from './tenant.types.js';

/**
 * @typedef {import('./tenant.types.js').TenantExecutionContext} TenantExecutionContext
 */

const RESOLVE_PATH = '/tenant/resolve';

/** Wire-level error codes returned by dashboard/tenant-router. */
const ROUTER_ERROR_CODES = Object.freeze({
  TENANT_NOT_FOUND: 'tenant_not_found',
  TENANT_SUSPENDED: 'tenant_suspended',
  ROUTING_UNAVAILABLE: 'routing_unavailable',
  MISSING_BRAND_ID: 'missing_brand_id',
});

const parseJsonSafe = async (body) => {
  try {
    return await body.json();
  } catch {
    return null;
  }
};

/**
 * Map a (status, payload.error) pair into the right typed error. Tenant-
 * router's error shape is `{ error: "<code>" }` — we prefer the code over
 * the status when both are present (status is right, but this is more
 * explicit for logging).
 *
 * @param {number} status
 * @param {unknown} payload
 * @param {string} brandId
 */
const mapRouterError = (status, payload, brandId) => {
  const code =
    payload && typeof payload === 'object' && 'error' in payload
      ? String(/** @type {Record<string, unknown>} */ (payload).error)
      : null;

  if (code === ROUTER_ERROR_CODES.TENANT_NOT_FOUND || status === 404) {
    return new TenantNotFoundError(brandId);
  }
  if (code === ROUTER_ERROR_CODES.TENANT_SUSPENDED || status === 403) {
    return new TenantSuspendedError(brandId);
  }
  if (
    code === ROUTER_ERROR_CODES.ROUTING_UNAVAILABLE ||
    status === 503 ||
    status === 504
  ) {
    return new TenantUnavailableError(brandId);
  }
  return new TenantRouterError(
    `tenant-router responded ${status}${code ? ` (${code})` : ''}`,
    { status: 502, details: { brandId, upstreamStatus: status, upstreamCode: code } },
  );
};

/**
 * Build a tenant-router client. Exposed as a factory so tests can inject a
 * fake `fetchImpl`.
 *
 * @param {{ baseUrl?: string, timeoutMs?: number, apiKey?: string, fetchImpl?: typeof request }} [options]
 */
export const createTenantClient = (options = {}) => {
  const baseUrl = options.baseUrl ?? env.tenantRouter.url;
  const timeoutMs = options.timeoutMs ?? env.tenantRouter.timeoutMs;
  const apiKey = options.apiKey ?? env.tenantRouter.apiKey;
  const fetchImpl = options.fetchImpl ?? request;

  if (!baseUrl) {
    throw new Error('tenant-router baseUrl not configured');
  }

  /**
   * Resolve a brand_id to a normalized tenant execution context.
   * @param {string} brandId
   * @param {{ correlationId?: string }} [ctx]
   * @returns {Promise<TenantExecutionContext>}
   */
  const resolve = async (brandId, ctx = {}) => {
    if (!brandId || typeof brandId !== 'string') {
      throw new TenantRouterError('brandId is required', {
        code: 'E_TENANT_BAD_REQUEST',
        status: 400,
      });
    }

    const url = new URL(RESOLVE_PATH, baseUrl).toString();
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    // tenant-router accepts x-pipeline-key as an internal bypass for
    // /tenant/resolve when calls skip the gateway. Service-to-service
    // calls from sql-agent can go direct to tenant-router inside the
    // docker network and use this header.
    if (apiKey) headers['x-pipeline-key'] = apiKey;
    if (ctx.correlationId) headers['x-correlation-id'] = ctx.correlationId;

    const started = Date.now();
    logger.info(
      { event: 'tenant.resolve.start', brandId, correlationId: ctx.correlationId },
      'tenant resolution started',
    );

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ brand_id: brandId }),
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
    } catch (err) {
      logger.error(
        {
          event: 'tenant.resolve.network_error',
          brandId,
          correlationId: ctx.correlationId,
          err,
        },
        'tenant router network error',
      );
      throw new TenantUnavailableError(brandId);
    }

    const status = response.statusCode;
    const payload = await parseJsonSafe(response.body);
    const elapsedMs = Date.now() - started;

    if (status < 200 || status >= 300) {
      const err = mapRouterError(status, payload, brandId);
      logger.warn(
        {
          event: 'tenant.resolve.error',
          brandId,
          status,
          code: err.code,
          elapsedMs,
          correlationId: ctx.correlationId,
        },
        'tenant router returned error',
      );
      throw err;
    }

    let normalized;
    try {
      const validated = assertTenantResolveResponse(payload);
      normalized = normalizeTenantResponse(validated);
    } catch (err) {
      logger.error(
        { event: 'tenant.resolve.invalid_payload', brandId, elapsedMs, err },
        'tenant router returned invalid payload',
      );
      throw new TenantRouterError('tenant-router returned invalid payload', {
        status: 502,
        code: 'E_TENANT_INVALID_PAYLOAD',
        cause: err,
        details: { brandId },
      });
    }

    logger.info(
      {
        event: 'tenant.resolve.ok',
        brandId,
        shardId: normalized.shardId,
        elapsedMs,
        correlationId: ctx.correlationId,
      },
      'tenant resolution succeeded',
    );
    return normalized;
  };

  return { resolve };
};

/** Default shared client used by request-scoped middleware. */
export const tenantClient = createTenantClient();
