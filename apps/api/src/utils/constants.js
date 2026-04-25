export const SQL_DIALECT = 'mysql';

export const ALLOWED_STATEMENT_TYPE = 'select';

/** Validation error codes returned by the validation layer. */
export const VALIDATION_CODES = Object.freeze({
  PARSE_FAILED: 'V_PARSE_FAILED',
  EMPTY_SQL: 'V_EMPTY_SQL',
  MULTIPLE_STATEMENTS: 'V_MULTIPLE_STATEMENTS',
  NOT_SELECT: 'V_NOT_SELECT',
  DDL_FORBIDDEN: 'V_DDL_FORBIDDEN',
  DML_FORBIDDEN: 'V_DML_FORBIDDEN',
  CROSS_DATABASE: 'V_CROSS_DATABASE',
  TABLE_NOT_ALLOWED: 'V_TABLE_NOT_ALLOWED',
  COLUMN_NOT_ALLOWED: 'V_COLUMN_NOT_ALLOWED',
  GROUP_BY_INVALID: 'V_GROUP_BY_INVALID',
  MISSING_LIMIT: 'V_MISSING_LIMIT',
  COST_EXCEEDED: 'V_COST_EXCEEDED',
});

/**
 * Node names used inside the LangGraph workflow.
 *
 * NOTE: LangGraph rejects node names that collide with state-channel
 * keys. Our channels include `plan`, so the planner node is registered
 * as `planner` (not `plan`). The conceptual graph order from the spec
 * — `load_schema -> plan -> generate_sql -> validate -> execute` — is
 * preserved; only the internal node id differs.
 */
export const NODE = Object.freeze({
  LOAD_SCHEMA: 'load_schema',
  PLAN: 'planner',
  GENERATE_SQL: 'generate_sql',
  VALIDATE: 'validate',
  EXECUTE: 'execute',
});

export const AGENT_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEMA_LOADED: 'schema_loaded',
  PLANNED: 'planned',
  CLARIFICATION_REQUIRED: 'clarification_required',
  SQL_DRAFTED: 'sql_drafted',
  VALIDATED: 'validated',
  EXECUTED: 'executed',
  FAILED: 'failed',
});

/** DDL / DML statement types rejected by the validation layer. */
export const BLOCKED_DDL = new Set([
  'create',
  'drop',
  'alter',
  'truncate',
  'rename',
]);

export const BLOCKED_DML = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'merge',
]);
