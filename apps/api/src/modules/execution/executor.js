import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  ExecutionError,
  QueryTimeoutError,
} from '../../utils/errors.js';
import { assertExecutionResult } from '../contracts/executionResult.js';
import { assertExecutionInput } from './execution.types.js';
import { getPoolForTenant } from './poolManager.js';

/**
 * @typedef {import('./execution.types.js').ExecutionInput} ExecutionInput
 * @typedef {import('../contracts/executionResult.js').ExecutionResult} ExecutionResult
 */

const isTimeoutError = (err) => {
  const code = /** @type {{ code?: string, errno?: number }} */ (err)?.code;
  return (
    code === 'ETIMEDOUT' ||
    code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    code === 'ER_QUERY_TIMEOUT'
  );
};

const normalizeRows = (raw, maxRows) => {
  const rows = Array.isArray(raw) ? raw : [];
  const truncated = rows.length > maxRows;
  const limited = truncated ? rows.slice(0, maxRows) : rows;
  const plainRows = limited.map((row) => {
    const record = /** @type {Record<string, unknown>} */ (row);
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(record)) out[key] = record[key];
    return out;
  });
  const columns = plainRows.length > 0 ? Object.keys(plainRows[0]) : [];
  return { rows: plainRows, columns, truncated };
};

/**
 * Execute a validated SELECT against the tenant database. This function
 * assumes the SQL has already passed validation — it MUST NOT be called
 * directly from a route without validation first.
 *
 * @param {ExecutionInput} input
 * @returns {Promise<ExecutionResult>}
 */
export const execute = async (input) => {
  const normalized = assertExecutionInput(input);
  const { tenant, sql, params = [], correlationId } = normalized;
  const timeoutMs = normalized.timeoutMs ?? env.execution.queryTimeoutMs;
  const maxRows = normalized.maxRows ?? env.execution.maxRows;

  const pool = getPoolForTenant(tenant);
  const started = process.hrtime.bigint();

  logger.info(
    {
      event: 'execution.start',
      correlationId,
      brandId: tenant.brandId,
      database: tenant.database,
      timeoutMs,
      maxRows,
    },
    'sql execution started',
  );

  let connection;
  try {
    connection = await pool.getConnection();

    // This service is read-only by design. Enforce it at the session level
    // even though validation already rejects DML — defence in depth is cheap
    // and catches any future path that bypasses the validator.
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query(`SET SESSION MAX_EXECUTION_TIME=${timeoutMs}`);

    const [rawRows] = await connection.query({
      sql,
      values: params,
      timeout: timeoutMs,
    });

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const { rows, columns, truncated } = normalizeRows(rawRows, maxRows);

    const result = {
      ok: true,
      columns,
      rows,
      stats: {
        rowCount: rows.length,
        elapsedMs,
        truncated,
      },
    };

    logger.info(
      {
        event: 'execution.ok',
        correlationId,
        brandId: tenant.brandId,
        rowCount: rows.length,
        truncated,
        elapsedMs,
      },
      'sql execution succeeded',
    );

    return assertExecutionResult(result);
  } catch (err) {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const timedOut = isTimeoutError(err);

    logger.error(
      {
        event: timedOut ? 'execution.timeout' : 'execution.error',
        correlationId,
        brandId: tenant.brandId,
        elapsedMs,
        err,
      },
      timedOut ? 'sql execution timed out' : 'sql execution failed',
    );

    if (timedOut) {
      throw new QueryTimeoutError(timeoutMs);
    }
    if (err instanceof ExecutionError) throw err;
    throw new ExecutionError(
      err instanceof Error ? err.message : 'sql execution failed',
      { brandId: tenant.brandId },
      err,
    );
  } finally {
    if (connection) {
      try {
        connection.release();
      } catch {
        /* ignore */
      }
    }
  }
};
