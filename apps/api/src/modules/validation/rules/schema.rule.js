import { tableList, columnList } from '../../../lib/parser.js';
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
  try {
    tables = tableList(sql);
    columns = columnList(sql);
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

  for (const entry of columns) {
    const { table, column } = parseColumnEntry(entry);
    if (!column || column === '*') continue;

    if (!table) {
      if (/\s/.test(column) && !existsInAnyAllowedTable(columnsByTable, column)) {
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
