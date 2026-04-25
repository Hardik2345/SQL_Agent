import { VALIDATION_CODES } from '../../../utils/constants.js';
import { issue } from '../../contracts/validationResult.js';

/**
 * Count `{ type: 'join' }`-style edges in a parsed SELECT's `from` clause.
 * node-sql-parser represents joins on the `from` array entries using a
 * `join` string (e.g. 'INNER JOIN'). We count every non-first entry that
 * carries a join property.
 *
 * @param {unknown} ast
 */
const countJoins = (ast) => {
  const root = Array.isArray(ast) ? ast[0] : ast;
  if (!root || typeof root !== 'object') return 0;
  const from = /** @type {Record<string, unknown>} */ (root).from;
  if (!Array.isArray(from)) return 0;
  let count = 0;
  for (const entry of from) {
    if (entry && typeof entry === 'object' && typeof /** @type {Record<string,unknown>} */ (entry).join === 'string') {
      count += 1;
    }
  }
  return count;
};

/**
 * Inspect a SELECT's GROUP BY / aggregate structure and flag the obvious
 * mistake: a non-aggregated select column that is not in GROUP BY when
 * GROUP BY is present.
 *
 * This is intentionally conservative — MySQL tolerates a lot that other
 * engines don't, so we only flag the structurally-obvious cases to avoid
 * false positives.
 *
 * @param {unknown} ast
 * @returns {import('../../contracts/validationResult.js').ValidationIssue[]}
 */
const checkGroupBy = (ast) => {
  const issues = [];
  const root = Array.isArray(ast) ? ast[0] : ast;
  if (!root || typeof root !== 'object') return issues;

  const node = /** @type {Record<string, unknown>} */ (root);
  // node-sql-parser has two historical shapes for `groupby`:
  //   - legacy: an array of column_ref nodes
  //   - current (v5+): an object `{ columns: [...], modifiers: [...] }`
  // Normalize to an array before processing.
  const rawGroupBy = node.groupby;
  const groupByEntries = Array.isArray(rawGroupBy)
    ? rawGroupBy
    : Array.isArray(/** @type {Record<string, unknown>} */ (rawGroupBy)?.columns)
      ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (rawGroupBy).columns)
      : [];
  if (groupByEntries.length === 0) return issues;

  const columns = Array.isArray(node.columns) ? node.columns : [];
  /** @type {Set<string>} */
  const groupKeys = new Set();
  for (const g of groupByEntries) {
    const col = /** @type {Record<string, unknown>} */ (g)?.column;
    if (typeof col === 'string') groupKeys.add(col.toLowerCase());
  }

  for (const column of columns) {
    if (!column || typeof column !== 'object') continue;
    const expr = /** @type {Record<string, unknown>} */ (column).expr;
    if (!expr || typeof expr !== 'object') continue;
    const exprNode = /** @type {Record<string, unknown>} */ (expr);

    const kind = exprNode.type;
    if (kind === 'aggr_func') continue;
    if (kind === 'column_ref') {
      const colName = typeof exprNode.column === 'string' ? exprNode.column : null;
      if (colName === '*') continue;
      if (colName && !groupKeys.has(colName.toLowerCase())) {
        issues.push(
          issue({
            code: VALIDATION_CODES.GROUP_BY_INVALID,
            message: `Column ${colName} is not in GROUP BY and is not aggregated`,
            severity: 'error',
            meta: { column: colName },
          }),
        );
      }
    }
  }

  return issues;
};

/**
 * Cost rule:
 *   - too many joins (policy.maxJoins)
 *   - GROUP BY correctness (basic)
 *   - optional LIMIT requirement (policy.requireLimit)
 *
 * @param {import('node-sql-parser').AST[]} ast
 * @param {NonNullable<import('../validation.types.js').ValidationInput['policy']>} policy
 * @returns {import('../../contracts/validationResult.js').ValidationIssue[]}
 */
export const runCostRule = (ast, policy) => {
  const issues = [];

  const joinCount = countJoins(ast);
  const maxJoins = policy.maxJoins ?? 6;
  if (joinCount > maxJoins) {
    issues.push(
      issue({
        code: VALIDATION_CODES.COST_EXCEEDED,
        message: `Too many joins: ${joinCount} > ${maxJoins}`,
        meta: { joinCount, maxJoins },
      }),
    );
  }

  issues.push(...checkGroupBy(ast));

  if (policy.requireLimit) {
    const root = Array.isArray(ast) ? ast[0] : ast;
    const hasLimit =
      !!root &&
      typeof root === 'object' &&
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (root)).limit != null;
    if (!hasLimit) {
      issues.push(
        issue({
          code: VALIDATION_CODES.MISSING_LIMIT,
          message: 'SELECT must include a LIMIT clause',
          severity: 'warning',
        }),
      );
    }
  }

  return issues;
};
