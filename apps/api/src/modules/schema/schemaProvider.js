import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { parseSchemaDump } from './schemaParser.js';
import { schemaCache } from './schemaCache.js';
import { assertSchemaContext } from './schema.types.js';

/**
 * @typedef {import('./schema.types.js').SchemaContext} SchemaContext
 * @typedef {import('../tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Default location of the checked-in dump. Resolved relative to this
 * file so the provider works regardless of CWD.
 *
 * From: apps/api/src/modules/schema/schemaProvider.js
 *   ../../../../../  → repo root
 *
 * (apps → api → src → modules → schema = 5 levels deep)
 */
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'schema', 'schema.sql');

const CACHE_KEY = 'schema_dump:v1';

/**
 * Resolve a SchemaContext for the current request.
 *
 * Phase 2A loads the checked-in schema dump from `schema/schema.sql`.
 * The tenant's database name (when available) is attached to the
 * context for downstream observability, but it does NOT change which
 * schema is loaded — every tenant uses the same dump until live
 * `information_schema` lookup is wired in a later phase.
 *
 * The provider:
 *   - never reads or returns credentials,
 *   - caches the parsed dump in-process keyed by `schema_dump:v1`,
 *   - logs once per cache miss (loud table-count signal),
 *   - validates the final SchemaContext via `assertSchemaContext`.
 *
 * @param {{ tenant?: TenantExecutionContext, correlationId?: string, schemaPath?: string }} [options]
 * @returns {Promise<SchemaContext>}
 */
export const getSchemaContext = async (options = {}) => {
  const { tenant, correlationId, schemaPath = DEFAULT_SCHEMA_PATH } = options;

  let parsed = /** @type {ReturnType<typeof parseSchemaDump> | undefined} */ (
    schemaCache.get(CACHE_KEY)
  );

  if (!parsed) {
    const sql = await fs.readFile(schemaPath, 'utf8');
    parsed = parseSchemaDump(sql);
    schemaCache.set(CACHE_KEY, parsed);
    logger.info(
      {
        event: 'schema.load',
        source: 'schema_dump',
        path: schemaPath,
        tableCount: parsed.allowedTables.length,
        joinCount: parsed.allowedJoins.length,
        correlationId,
      },
      'schema dump parsed and cached',
    );
  } else {
    logger.debug(
      {
        event: 'schema.cache_hit',
        tableCount: parsed.allowedTables.length,
        correlationId,
      },
      'schema served from cache',
    );
  }

  /** @type {SchemaContext} */
  const context = {
    dialect: 'mysql',
    source: 'schema_dump',
    database: tenant?.database ?? null,
    tables: parsed.tables,
    allowedTables: parsed.allowedTables,
    allowedColumns: parsed.allowedColumns,
    allowedJoins: parsed.allowedJoins,
  };

  return assertSchemaContext(context);
};
