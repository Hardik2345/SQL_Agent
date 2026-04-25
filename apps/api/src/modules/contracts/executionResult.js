import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * @typedef {Object} ExecutionStats
 * @property {number}  rowCount         Rows returned.
 * @property {number}  elapsedMs        Wall-clock duration, measured server-side.
 * @property {boolean} truncated        True if results were cut off at maxRows.
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean}                         ok         Whether execution succeeded.
 * @property {string[]}                        columns    Column names in output order.
 * @property {Array<Record<string, unknown>>}  rows       Row records keyed by column name.
 * @property {ExecutionStats}                  stats      Execution statistics.
 * @property {string}                          [error]    Error message when ok is false.
 * @property {string}                          [errorCode] Stable error code when ok is false.
 */

const statsSchema = check.object({
  rowCount: check.number({ integer: true, min: 0 }),
  elapsedMs: check.number({ min: 0 }),
  truncated: check.boolean(),
});

const schema = check.object({
  ok: check.boolean(),
  columns: check.array(check.nonEmptyString()),
  rows: check.array(check.record(() => [])),
  stats: statsSchema,
  error: check.string({ required: false }),
  errorCode: check.string({ required: false }),
});

/**
 * @param {unknown} value
 * @returns {ExecutionResult}
 */
export const assertExecutionResult = (value) =>
  assertContract('ExecutionResult', schema, value);
