import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// Configure env BEFORE the middleware imports — env.js is frozen at load time.
process.env.TENANT_ROUTER_URL = 'http://tenant-router:3004';
process.env.GATEWAY_SHARED_SECRET = 'test-secret-32-bytes-minimum-ok';

/** Build a request that carries a valid gateway signature. */
const signedRequest = (overrides = {}) => {
  const userId = overrides.userId ?? 'user_1';
  const brandId = overrides.brandId ?? 'BRAND_1';
  const role = overrides.role ?? 'viewer';
  const ts = overrides.ts ?? Math.floor(Date.now() / 1000).toString();
  const sig =
    overrides.sig ??
    createHmac('sha256', 'test-secret-32-bytes-minimum-ok')
      .update(`${userId}|${brandId}|${role}|${ts}`)
      .digest('hex');

  return {
    headers: {
      'x-user-id': userId,
      'x-brand-id': brandId,
      'x-role': role,
      'x-gw-ts': ts,
      'x-gw-sig': sig,
      ...overrides.headers,
    },
    body: {},
  };
};

const mockRes = () => {
  const res = {
    statusCode: 0,
    payload: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
  return res;
};

describe('tenantContext middleware — gateway trust', () => {
  /** @type {typeof import('../../apps/api/src/middleware/tenantContext.middleware.js').tenantContextMiddleware} */
  let tenantContextMiddleware;

  before(async () => {
    // Import lazily so the env setup above takes effect.
    ({ tenantContextMiddleware } = await import(
      '../../apps/api/src/middleware/tenantContext.middleware.js'
    ));
  });

  it('rejects requests missing gateway headers with 401', async () => {
    const req = { headers: {}, body: {} };
    const res = mockRes();
    let nextCalled = false;
    await tenantContextMiddleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error.code, 'E_GATEWAY_AUTH');
    assert.equal(nextCalled, false);
  });

  it('rejects requests with a bad signature', async () => {
    const req = signedRequest({ sig: 'deadbeef'.repeat(8) });
    const res = mockRes();
    await tenantContextMiddleware(req, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error.code, 'E_GATEWAY_AUTH');
    assert.equal(res.payload.error.details.reason, 'signature_mismatch');
  });

  it('rejects expired signatures', async () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 3600).toString();
    const req = signedRequest({ ts: oldTs });
    const res = mockRes();
    await tenantContextMiddleware(req, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.error.details.reason, 'signature_expired');
  });

  it('ignores body.brandId even when gateway-signed', async () => {
    const req = signedRequest();
    req.body = { brandId: 'ATTACKER_BRAND' };
    const res = mockRes();
    let captured;
    await tenantContextMiddleware(req, res, () => {
      captured = req.brandId;
    });
    // We can't reach tenant-router in this test, so expect the error path —
    // but the brandId that got through must be from the header, not body.
    // The attempt will fail at tenant resolution, not before.
    assert.notEqual(req.brandId, 'ATTACKER_BRAND');
    // Either we made it past signature check (brandId === 'BRAND_1') OR
    // the tenant client errored. Both are fine for this assertion.
  });
});
