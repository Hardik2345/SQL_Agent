import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * @typedef {import('../tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 */

/**
 * @typedef {Object} ExecutionInput
 * @property {TenantExecutionContext} tenant         Normalized tenant execution context.
 * @property {string}                 sql            Validated SQL to execute (SELECT only).
 * @property {Array<unknown>}         [params]       Optional positional parameters.
 * @property {number}                 [timeoutMs]    Override query timeout.
 * @property {number}                 [maxRows]      Override max row limit.
 * @property {string}                 [correlationId] Optional correlation id.
 */

const schema = check.object({
  tenant: check.object(
    {
      poolKey: check.nonEmptyString(),
      host: check.nonEmptyString(),
      port: check.number({ integer: true, min: 1, max: 65535 }),
      database: check.nonEmptyString(),
      credentials: check.object({
        user: check.nonEmptyString(),
        password: check.nonEmptyString(),
      }),
    },
    { required: true },
  ),
  sql: check.nonEmptyString(),
  params: check.array(() => [], { required: false }),
  timeoutMs: check.number({ required: false, integer: true, min: 1 }),
  maxRows: check.number({ required: false, integer: true, min: 1 }),
  correlationId: check.nonEmptyString({ required: false }),
});

/** @param {unknown} value */
export const assertExecutionInput = (value) =>
  assertContract('ExecutionInput', schema, value);
