/**
 * Shared MySQL-related typedefs. Pure JSDoc — no runtime exports.
 */

/**
 * Minimal shape of a mysql2 connection pool we rely on internally.
 * @typedef {import('mysql2/promise').Pool} MysqlPool
 */

/**
 * @typedef {Object} MysqlConnectionConfig
 * @property {string} host
 * @property {number} port
 * @property {string} database
 * @property {string} user
 * @property {string} password
 * @property {number} [connectionLimit]
 * @property {number} [idleTimeout]
 */

/**
 * @typedef {Object} MysqlColumnMeta
 * @property {string} name
 * @property {string} type
 * @property {boolean} [nullable]
 */

/**
 * @typedef {Object} MysqlTableMeta
 * @property {string} name
 * @property {MysqlColumnMeta[]} columns
 */

export {};
