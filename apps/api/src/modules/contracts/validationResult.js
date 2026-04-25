import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * @typedef {Object} ValidationIssue
 * @property {string}                    code      Stable validation error code (V_*).
 * @property {string}                    message   Human readable message.
 * @property {'error'|'warning'}         severity  Issue severity; only 'error' blocks execution.
 * @property {Record<string, unknown>}   [meta]    Additional structured metadata.
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean}            valid        True iff no 'error'-severity issues were found.
 * @property {ValidationIssue[]}  issues       All issues produced by all rules.
 * @property {string}             [normalizedSql] Canonical SQL form produced by the parser.
 */

const issueSchema = check.object({
  code: check.nonEmptyString(),
  message: check.nonEmptyString(),
  severity: check.oneOf(['error', 'warning']),
  meta: check.record(() => [], { required: false }),
});

const schema = check.object({
  valid: check.boolean(),
  issues: check.array(issueSchema),
  normalizedSql: check.nonEmptyString({ required: false }),
});

/**
 * @param {unknown} value
 * @returns {ValidationResult}
 */
export const assertValidationResult = (value) =>
  assertContract('ValidationResult', schema, value);

/**
 * @param {Partial<ValidationIssue>} partial
 * @returns {ValidationIssue}
 */
export const issue = (partial) => ({
  severity: 'error',
  meta: {},
  ...partial,
  code: String(partial.code),
  message: String(partial.message),
});
