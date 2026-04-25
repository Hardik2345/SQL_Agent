import { assertContract, check } from '../../lib/runtimeValidators.js';
import { assertSchemaContext as assertCanonicalSchemaContext } from '../schema/schema.types.js';

/**
 * The validation layer consumes the canonical SchemaContext defined in
 * `modules/schema/schema.types.js`. We re-export the canonical typedef
 * here for callers that historically imported it from this file, and
 * delegate runtime validation of the embedded schema to the canonical
 * `assertSchemaContext`.
 *
 * @typedef {import('../schema/schema.types.js').SchemaContext} SchemaContext
 * @typedef {import('../schema/schema.types.js').SchemaTable}   SchemaTable
 * @typedef {import('../schema/schema.types.js').SchemaColumn}  SchemaColumn
 */

/**
 * @typedef {Object} ValidationInput
 * @property {string}        sql            Raw SQL produced by the generator.
 * @property {SchemaContext} schema         Schema context for the target tenant.
 * @property {Object}        [policy]       Optional cost/safety policy overrides.
 * @property {number}        [policy.maxJoins]
 * @property {number}        [policy.maxRowsHint]
 * @property {boolean}       [policy.requireLimit]
 */

/**
 * @typedef {Object} RuleContext
 * @property {string}        sql
 * @property {import('node-sql-parser').AST[]} ast
 * @property {SchemaContext} schema
 * @property {NonNullable<ValidationInput['policy']>} policy
 */

// Shape-level check for `schema` inside ValidationInput. Cross-reference
// integrity (allowedTables exist in tables, etc.) is enforced separately
// by `assertCanonicalSchemaContext` re-exported below.
const schemaShape = check.object({
  dialect: check.oneOf(['mysql']),
  source: check.nonEmptyString(),
  database: () => [], // string|null — full validation is delegated
  tables: check.record(() => []),
  allowedTables: check.array(check.nonEmptyString()),
  allowedColumns: check.record(check.array(check.nonEmptyString())),
  allowedJoins: check.array(() => []),
});

const inputSchema = check.object({
  // Empty / whitespace SQL is reported as a structured V_EMPTY_SQL issue by
  // the syntax rule rather than a contract violation, so the caller gets a
  // ValidationResult instead of a thrown error.
  sql: check.string(),
  schema: schemaShape,
  policy: check.object(
    {
      maxJoins: check.number({ required: false, integer: true, min: 0 }),
      maxRowsHint: check.number({ required: false, integer: true, min: 1 }),
      requireLimit: check.boolean({ required: false }),
    },
    { required: false },
  ),
});

/**
 * Runtime validator for a SchemaContext. Delegates to the canonical
 * implementation so cross-reference invariants stay enforced in one
 * place. Re-exported here for backwards compatibility with callers that
 * historically imported `assertSchemaContext` from validation.types.
 *
 * @param {unknown} value
 */
export const assertSchemaContext = (value) => assertCanonicalSchemaContext(value);

/** @param {unknown} value */
export const assertValidationInput = (value) =>
  assertContract('ValidationInput', inputSchema, value);
