import {
  BLOCKED_DDL,
  BLOCKED_DML,
  VALIDATION_CODES,
} from '../../../utils/constants.js';
import { issue } from '../../contracts/validationResult.js';

/**
 * Walk an AST recursively and collect every `.db` property value found on
 * table references. In node-sql-parser, `db` is the database qualifier on a
 * table node (e.g. `otherdb.users` → `{ db: 'otherdb', table: 'users' }`).
 * We reject any cross-database reference because this service binds a
 * connection to a single tenant database at the pool layer.
 *
 * @param {unknown} node
 * @param {Set<string>} out
 */
const collectDbQualifiers = (node, out) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectDbQualifiers(item, out);
    return;
  }
  const record = /** @type {Record<string, unknown>} */ (node);
  if (
    typeof record.table === 'string' &&
    typeof record.db === 'string' &&
    record.db.trim().length > 0
  ) {
    out.add(record.db);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectDbQualifiers(value, out);
  }
};

/**
 * Walk an AST and collect every statement `type` (the discriminator used by
 * node-sql-parser — 'select', 'insert', 'update', 'delete', 'create', …).
 * We use this to catch DDL/DML buried inside WITH clauses or subqueries,
 * not just the top-level statement.
 *
 * @param {unknown} node
 * @param {Set<string>} out
 */
const collectStatementTypes = (node, out) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectStatementTypes(item, out);
    return;
  }
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.type === 'string' && typeof record.columns !== 'undefined') {
    out.add(record.type.toLowerCase());
  }
  if (
    typeof record.type === 'string' &&
    (BLOCKED_DDL.has(record.type.toLowerCase()) ||
      BLOCKED_DML.has(record.type.toLowerCase()))
  ) {
    out.add(record.type.toLowerCase());
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectStatementTypes(value, out);
  }
};

/**
 * Safety rule:
 *   - no DDL anywhere in the tree
 *   - no DML anywhere in the tree
 *   - no cross-database references
 *
 * @param {import('node-sql-parser').AST[]} ast
 * @param {string} expectedDatabase
 * @returns {import('../../contracts/validationResult.js').ValidationIssue[]}
 */
export const runSafetyRule = (ast, expectedDatabase) => {
  const issues = [];
  const stmtTypes = new Set();
  collectStatementTypes(ast, stmtTypes);

  for (const type of stmtTypes) {
    if (BLOCKED_DDL.has(type)) {
      issues.push(
        issue({
          code: VALIDATION_CODES.DDL_FORBIDDEN,
          message: `DDL statement not allowed: ${type.toUpperCase()}`,
          meta: { statementType: type },
        }),
      );
    }
    if (BLOCKED_DML.has(type)) {
      issues.push(
        issue({
          code: VALIDATION_CODES.DML_FORBIDDEN,
          message: `DML statement not allowed: ${type.toUpperCase()}`,
          meta: { statementType: type },
        }),
      );
    }
  }

  const dbs = new Set();
  collectDbQualifiers(ast, dbs);
  for (const db of dbs) {
    if (db !== expectedDatabase) {
      issues.push(
        issue({
          code: VALIDATION_CODES.CROSS_DATABASE,
          message: `Cross-database reference is not allowed: ${db}`,
          meta: { referencedDatabase: db, expectedDatabase },
        }),
      );
    }
  }

  return issues;
};
