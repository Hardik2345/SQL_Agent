import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * @typedef {Object} QueryRequest
 * @property {string} brandId           Brand identifier used for tenant resolution.
 * @property {string} question          Natural-language analytics question from the user.
 * @property {string} [correlationId]   Optional external correlation id; generated if absent.
 * @property {Record<string, unknown>} [context] Free-form caller context (UI filters, etc).
 */

const schema = check.object({
  brandId: check.nonEmptyString(),
  question: check.string({ min: 3, max: 4000 }),
  correlationId: check.nonEmptyString({ required: false }),
  context: check.record(() => [], { required: false }),
});

/**
 * @param {unknown} value
 * @returns {QueryRequest}
 */
export const assertQueryRequest = (value) =>
  assertContract('QueryRequest', schema, value);
