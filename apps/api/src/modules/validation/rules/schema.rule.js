import { tableList, columnList, parseSql } from '../../../lib/parser.js';
import { VALIDATION_CODES } from '../../../utils/constants.js';
import { issue } from '../../contracts/validationResult.js';

/**
 * node-sql-parser encodes tableList entries as `op::db::table` strings.
 * We only care about `db` and `table` here.
 * @param {string} entry
 */
const parseTableEntry = (entry) => {
  const parts = entry.split('::');
  const [op, db, table] = parts.length === 3 ? parts : [parts[0], null, parts[1]];
  return { op, db: db === 'null' ? null : db, table };
};

/**
 * columnList entries are `op::table::column`.
 * @param {string} entry
 */
const parseColumnEntry = (entry) => {
  const parts = entry.split('::');
  const [op, table, column] = parts.length === 3 ? parts : [parts[0], null, parts[1]];
  return { op, table: table === 'null' ? null : table, column };
};

/**
 * Returns true if `column` exists in at least one of the allowed tables.
 * Used to validate unqualified identifiers that cannot be table-bound.
 *
 * @param {Map<string, Set<string>>} columnsByTable
 * @param {string} column
 */
const existsInAnyAllowedTable = (columnsByTable, column) => {
  const needle = column.toLowerCase();
  for (const cols of columnsByTable.values()) {
    if (cols.has(needle)) return true;
  }
  return false;
};

/**
 * Returns true if `column` exists in at least one of the referenced
 * tables from the current SQL statement.
 *
 * @param {Map<string, Set<string>>} columnsByTable
 * @param {Set<string>} referencedTables
 * @param {string} column
 */
const existsInReferencedTables = (columnsByTable, referencedTables, column) => {
  const needle = column.toLowerCase();
  for (const table of referencedTables) {
    const cols = columnsByTable.get(table);
    if (cols?.has(needle)) return true;
  }
  return false;
};

/**
 * Collect SELECT output aliases from one AST node (including UNION branches
 * and all nested subqueries in FROM clauses). This ensures that an alias
 * defined in an inner subquery (e.g. `conversion_rate` in a derived table)
 * is not falsely flagged as an unknown column when it appears unqualified in
 * ORDER BY or a parent SELECT.
 *
 * @param {any} astNode
 * @param {Set<string>} out
 */
const collectSelectAliasesFromAst = (astNode, out) => {
  if (!astNode || typeof astNode !== 'object') return;

  // Collect aliases from this level's SELECT columns
  const columns = Array.isArray(astNode.columns) ? astNode.columns : [];
  for (const col of columns) {
    if (typeof col?.as === 'string' && col.as.trim()) {
      out.add(col.as.toLowerCase());
    }
  }

  // Recurse into FROM-clause subqueries (derived tables / CTEs)
  const from = Array.isArray(astNode.from) ? astNode.from : [];
  for (const fromEntry of from) {
    if (fromEntry?.expr?.ast && typeof fromEntry.expr.ast === 'object') {
      collectSelectAliasesFromAst(fromEntry.expr.ast, out);
    } else if (fromEntry?.expr && typeof fromEntry.expr === 'object') {
      collectSelectAliasesFromAst(fromEntry.expr, out);
    }
  }

  // node-sql-parser represents UNION chains through `_next` in many versions.
  if (astNode._next && typeof astNode._next === 'object') {
    collectSelectAliasesFromAst(astNode._next, out);
  }
};

/**
 * Schema rule:
 *   - every referenced table must be in the allowed schema list
 *   - every qualified column must be in its table's allowed column list
 *   - unqualified identifiers that contain whitespace and do not exist in
 *     any allowed table are flagged (they are hallucinated column names)
 *
 * We otherwise skip validation for unqualified columns and for '*',
 * because node-sql-parser can only resolve those with full binding info.
 *
 * Uses the canonical SchemaContext (`allowedTables`, `allowedColumns`)
 * produced by the schema provider — no longer the legacy
 * `tables: SchemaTable[]` shape.
 *
 * @param {string} sql
 * @param {import('../validation.types.js').SchemaContext} schema
 * @returns {import('../../contracts/validationResult.js').ValidationIssue[]}
 */
export const runSchemaRule = (sql, schema) => {
  const issues = [];

  const allowedTableNames = new Set(
    schema.allowedTables.map((t) => t.toLowerCase()),
  );
  /** @type {Map<string, Set<string>>} */
  const columnsByTable = new Map(
    Object.entries(schema.allowedColumns).map(([tableName, cols]) => [
      tableName.toLowerCase(),
      new Set(cols.map((c) => c.toLowerCase())),
    ]),
  );

  let tables;
  let columns;
  /** @type {Set<string>} */
  const selectAliases = new Set();
  try {
    tables = tableList(sql);
    columns = columnList(sql);
    const astList = parseSql(sql);
    for (const ast of astList) {
      collectSelectAliasesFromAst(ast, selectAliases);
    }
  } catch (err) {
    issues.push(
      issue({
        code: VALIDATION_CODES.PARSE_FAILED,
        message: `Schema rule failed to inspect SQL: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
    return issues;
  }

  for (const entry of tables) {
    const { table } = parseTableEntry(entry);
    if (!table) continue;
    if (!allowedTableNames.has(table.toLowerCase())) {
      issues.push(
        issue({
          code: VALIDATION_CODES.TABLE_NOT_ALLOWED,
          message: `Table not allowed: ${table}`,
          meta: { table },
        }),
      );
    }
  }

  const referencedTables = new Set(
    tables
      .map((entry) => parseTableEntry(entry).table?.toLowerCase())
      .filter((t) => typeof t === 'string' && allowedTableNames.has(t)),
  );

  for (const entry of columns) {
    const { table, column } = parseColumnEntry(entry);
    if (!column || column === '*') continue;

    if (!table) {
      if (selectAliases.has(column.toLowerCase())) {
        continue;
      }

      const existsInScope =
        referencedTables.size > 0
          ? existsInReferencedTables(columnsByTable, referencedTables, column)
          : existsInAnyAllowedTable(columnsByTable, column);

      if (!existsInScope) {
        issues.push(
          issue({
            code: VALIDATION_CODES.COLUMN_NOT_ALLOWED,
            message: `Column not allowed: ${column}`,
            meta: { column, qualified: false },
          }),
        );
      }
      continue;
    }

    const allowed = columnsByTable.get(table.toLowerCase());
    if (!allowed) continue;
    if (!allowed.has(column.toLowerCase())) {
      issues.push(
        issue({
          code: VALIDATION_CODES.COLUMN_NOT_ALLOWED,
          message: `Column not allowed on table ${table}: ${column}`,
          meta: { table, column },
        }),
      );
    }
  }

  return issues;
};
