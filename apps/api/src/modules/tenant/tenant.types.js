import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * Raw payload returned by tenant-router's `POST /tenant/resolve`.
 *
 * Mirrors the real contract from dashboard/tenant-router:
 *   - snake_case, flat shape (no nested `credentials`)
 *   - `rds_proxy_endpoint` is the DB host
 *   - `brand_id` is the tenant identifier (there is no separate `tenant_id`)
 *   - `status` must be 'active' for the tenant to be usable (tenant-router
 *     will already reject 'suspended' with a 403, but we defence-in-depth
 *     check it here too)
 *   - Shopify-specific fields (shop_name, api_version, access_token, …)
 *     are ignored by this service
 *
 * @typedef {Object} TenantResolveResponse
 * @property {string} brand_id
 * @property {string} [shard_id]
 * @property {string} rds_proxy_endpoint
 * @property {string} database
 * @property {string} user
 * @property {string} password
 * @property {number} port
 * @property {string} status
 * @property {string} [db_host]
 * @property {string} [speed_key]
 */

const resolveResponseSchema = check.object({
  brand_id: check.nonEmptyString(),
  shard_id: check.nonEmptyString({ required: false }),
  rds_proxy_endpoint: check.nonEmptyString(),
  database: check.nonEmptyString(),
  user: check.nonEmptyString(),
  password: check.nonEmptyString(),
  port: check.number({ integer: true, min: 1, max: 65535 }),
  status: check.nonEmptyString(),
  db_host: check.nonEmptyString({ required: false }),
  speed_key: check.nonEmptyString({ required: false }),
});

/**
 * Internal normalized tenant execution context. Credentials remain opaque
 * — never logged, never serialized, redacted by the pino config.
 *
 * @typedef {Object} TenantExecutionContext
 * @property {string}  brandId
 * @property {string}  database
 * @property {string}  host             From `rds_proxy_endpoint`.
 * @property {number}  port
 * @property {string}  [shardId]
 * @property {string}  poolKey          Stable key used to cache the MySQL pool.
 * @property {{ user: string, password: string }} credentials
 */

const contextSchema = check.object({
  brandId: check.nonEmptyString(),
  database: check.nonEmptyString(),
  host: check.nonEmptyString(),
  port: check.number({ integer: true, min: 1, max: 65535 }),
  shardId: check.nonEmptyString({ required: false }),
  poolKey: check.nonEmptyString(),
  credentials: check.object({
    user: check.nonEmptyString(),
    password: check.nonEmptyString(),
  }),
});

/** @param {unknown} value */
export const assertTenantResolveResponse = (value) =>
  assertContract('TenantResolveResponse', resolveResponseSchema, value);

/** @param {unknown} value */
export const assertTenantExecutionContext = (value) =>
  assertContract('TenantExecutionContext', contextSchema, value);

/**
 * Normalize the raw tenant-router response into the internal execution
 * context used by the rest of the service. `status` is asserted 'active'
 * here — tenant-router already enforces this, but we check again because
 * it's cheap and prevents any accidental path where a suspended tenant
 * response is reused (e.g., via stale cache).
 *
 * @param {TenantResolveResponse} raw
 * @returns {TenantExecutionContext}
 */
export const normalizeTenantResponse = (raw) => {
  if (raw.status !== 'active') {
    throw new Error(`tenant status is not active: ${raw.status}`);
  }
  const normalized = {
    brandId: raw.brand_id,
    database: raw.database,
    host: raw.rds_proxy_endpoint,
    port: raw.port,
    shardId: raw.shard_id,
    poolKey: `${raw.brand_id}:${raw.rds_proxy_endpoint}:${raw.port}:${raw.database}`,
    credentials: {
      user: raw.user,
      password: raw.password,
    },
  };
  return assertTenantExecutionContext(normalized);
};
