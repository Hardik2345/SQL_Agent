import { parseSql } from '../../../lib/parser.js';
import { VALIDATION_CODES } from '../../../utils/constants.js';
import { issue } from '../../contracts/validationResult.js';

/**
 * Syntax / structural rule:
 *   - non-empty SQL
 *   - parses successfully
 *   - exactly one statement
 *   - statement type is SELECT
 *
 * Returns an object containing issues and, on success, the parsed AST so
 * downstream rules do not have to re-parse.
 *
 * @param {string} sql
 * @returns {{ issues: import('../../contracts/validationResult.js').ValidationIssue[], ast: import('node-sql-parser').AST[] | null }}
 */
export const runSyntaxRule = (sql) => {
  const issues = [];

  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    issues.push(
      issue({
        code: VALIDATION_CODES.EMPTY_SQL,
        message: 'SQL is empty',
      }),
    );
    return { issues, ast: null };
  }

  let ast;
  try {
    ast = parseSql(sql);
  } catch (err) {
    issues.push(
      issue({
        code: VALIDATION_CODES.PARSE_FAILED,
        message: `Failed to parse SQL: ${err instanceof Error ? err.message : String(err)}`,
        meta: { parserError: err instanceof Error ? err.message : String(err) },
      }),
    );
    return { issues, ast: null };
  }

  if (!Array.isArray(ast) || ast.length === 0) {
    issues.push(
      issue({
        code: VALIDATION_CODES.PARSE_FAILED,
        message: 'Parser returned no statements',
      }),
    );
    return { issues, ast: null };
  }

  if (ast.length > 1) {
    issues.push(
      issue({
        code: VALIDATION_CODES.MULTIPLE_STATEMENTS,
        message: 'Multiple statements are not allowed',
        meta: { statementCount: ast.length },
      }),
    );
    return { issues, ast: null };
  }

  const [first] = ast;
  const stmtType = typeof first?.type === 'string' ? first.type.toLowerCase() : '';
  if (stmtType !== 'select') {
    issues.push(
      issue({
        code: VALIDATION_CODES.NOT_SELECT,
        message: `Only SELECT statements are allowed, got ${stmtType || 'unknown'}`,
        meta: { statementType: stmtType },
      }),
    );
    return { issues, ast: null };
  }

  return { issues, ast };
};
