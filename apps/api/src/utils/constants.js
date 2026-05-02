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
  LOAD_CONTEXT: 'load_context',
  PLAN: 'planner',
  GENERATE_SQL: 'generate_sql',
  VALIDATE: 'validate',
  CORRECT: 'correct',
  EXECUTE: 'execute',
  EXPLAIN_RESULT: 'explain_result',
});

export const AGENT_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEMA_LOADED: 'schema_loaded',
  CONTEXT_LOADED: 'context_loaded',
  PLANNED: 'planned',
  CLARIFICATION_REQUIRED: 'clarification_required',
  MEMORY_UPDATE_REQUIRED: 'memory_update_required',
  SQL_DRAFTED: 'sql_drafted',
  CORRECTING: 'correcting',
  VALIDATED: 'validated',
  EXECUTED: 'executed',
  FAILED: 'failed',
});

/**
 * Hard ceiling on automated correction attempts. Configurable via the
 * `MAX_CORRECTION_ATTEMPTS` env var; the compile-time default below is
 * the safer fallback. Higher values cost LLM tokens and rarely
 * converge if the SQL is fundamentally wrong.
 */
export const MAX_CORRECTION_ATTEMPTS_DEFAULT = 2;

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
