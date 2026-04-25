import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * @typedef {Object} SqlDraft
 * @property {string}   sql          Raw SQL produced by the generation node.
 * @property {string}   dialect      Target SQL dialect (always 'mysql' in Phase 1).
 * @property {string[]} tables       Tables referenced by the draft, as claimed by the generator.
 * @property {string}   [rationale]  Free-form rationale from the generator, kept for logs.
 */

const schema = check.object({
  sql: check.nonEmptyString(),
  dialect: check.oneOf(['mysql']),
  tables: check.array(check.nonEmptyString()),
  rationale: check.string({ required: false, max: 4000 }),
});

/**
 * @param {unknown} value
 * @returns {SqlDraft}
 */
export const assertSqlDraft = (value) =>
  assertContract('SqlDraft', schema, value);
