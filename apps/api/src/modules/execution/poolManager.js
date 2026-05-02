import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {import('../tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 * @typedef {import('mysql2/promise').Pool} Pool
 */

/** @type {Map<string, Pool>} */
const pools = new Map();

/**
 * Get (or lazily create) a MySQL pool for the given tenant execution
 * context. Pools are keyed by the tenant-router-derived poolKey to ensure
 * strict per-tenant isolation.
 *
 * @param {TenantExecutionContext} tenant
 * @returns {Pool}
 */
export const getPoolForTenant = (tenant) => {
  const existing = pools.get(tenant.poolKey);
  if (existing) return existing;

  const pool = mysql.createPool({
    host: tenant.host,
    port: tenant.port,
    database: tenant.database,
    user: tenant.credentials.user,
    password: tenant.credentials.password,
    connectionLimit: env.execution.poolConnectionLimit,
    idleTimeout: env.execution.poolIdleTimeoutMs,
    waitForConnections: true,
    multipleStatements: false,
    dateStrings: true,
    timezone: 'Z',
    namedPlaceholders: false,
    typeCast: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    ...(env.execution.ssl ? { ssl: { rejectUnauthorized: env.execution.sslRejectUnauthorized } } : {}),
  });

  pools.set(tenant.poolKey, pool);
  logger.info(
    {
      event: 'pool.created',
      brandId: tenant.brandId,
      poolKey: tenant.poolKey,
      host: tenant.host,
      database: tenant.database,
    },
    'mysql pool created',
  );
  return pool;
};

/** Close a specific tenant pool (for tenant eviction scenarios). */
export const closePool = async (poolKey) => {
  const pool = pools.get(poolKey);
  if (!pool) return;
  pools.delete(poolKey);
  try {
    await pool.end();
    logger.info({ event: 'pool.closed', poolKey }, 'mysql pool closed');
  } catch (err) {
    logger.warn({ event: 'pool.close_error', poolKey, err }, 'mysql pool close error');
  }
};

/** Close every pool — intended for graceful shutdown only. */
export const closeAllPools = async () => {
  const entries = Array.from(pools.entries());
  pools.clear();
  await Promise.allSettled(
    entries.map(async ([poolKey, pool]) => {
      try {
        await pool.end();
        logger.info({ event: 'pool.closed', poolKey }, 'mysql pool closed');
      } catch (err) {
        logger.warn({ event: 'pool.close_error', poolKey, err }, 'mysql pool close error');
      }
    }),
  );
};

/** Exposed for tests. */
export const _poolRegistry = pools;
