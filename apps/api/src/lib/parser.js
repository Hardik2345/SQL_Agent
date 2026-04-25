import sqlParserPkg from 'node-sql-parser';
import { SQL_DIALECT } from '../utils/constants.js';

const { Parser } = sqlParserPkg;
const parser = new Parser();

/** @typedef {import('node-sql-parser').AST} AST */

/**
 * Parse SQL into an AST array. Throws on parse failure.
 * @param {string} sql
 * @returns {AST[]}
 */
export const parseSql = (sql) => {
  const ast = parser.astify(sql, { database: SQL_DIALECT });
  return Array.isArray(ast) ? ast : [ast];
};

/**
 * Tables-list helper from node-sql-parser. Returns array of strings like
 * `select::<db>::<table>`.
 * @param {string} sql
 * @returns {string[]}
 */
export const tableList = (sql) => parser.tableList(sql, { database: SQL_DIALECT });

/**
 * Column list helper. Returns strings like `select::<table>::<column>`.
 * @param {string} sql
 * @returns {string[]}
 */
export const columnList = (sql) =>
  parser.columnList(sql, { database: SQL_DIALECT });

/**
 * Serialize an AST back to SQL (canonical form).
 * @param {AST | AST[]} ast
 * @returns {string}
 */
export const toSql = (ast) => parser.sqlify(ast, { database: SQL_DIALECT });
