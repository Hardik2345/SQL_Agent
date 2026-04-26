import { buildSqlSchemaDigest } from '../sql/sqlContext.js';

/**
 * Correction-prompt context builder.
 *
 * Mirrors `modules/sql/sqlContext.js` and `modules/planner/plannerContext.js`:
 *   - pure / deterministic / no I/O,
 *   - never includes credentials or tenant routing,
 *   - never includes the raw schema dump,
 *   - scopes the schema digest to `plan.targetTables` to keep tokens
 *     bounded,
 *   - mirrors the SQL-generator inputs so the LLM has identical
 *     grounding to the one that produced the failing draft, plus the
 *     V_* validation issues that need to be fixed.
 *
 * @typedef {import('../contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../contracts/queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('../contracts/queryPlan.js').MetricDefinition} MetricDefinition
 * @typedef {import('../contracts/sqlDraft.js').SqlDraft} SqlDraft
 * @typedef {import('../contracts/validationResult.js').ValidationResult} ValidationResult
 * @typedef {import('../contracts/validationResult.js').ValidationIssue} ValidationIssue
 * @typedef {import('../schema/schema.types.js').SchemaContext} SchemaContext
 *
 * @typedef {Object} CorrectionContext
 * @property {string}                   question
 * @property {QueryPlan}                plan
 * @property {string}                   failedSql
 * @property {ValidationIssue[]}        validationIssues
 * @property {string[]}                 allowedTables
 * @property {Record<string, string[]>} allowedColumns
 * @property {Array<{ name: string, columns: Array<{ name: string, type: string }>, primaryKey: string[] }>} tables
 * @property {MetricDefinition[]}       metricDefinitions
 * @property {string[]}                 assumptions
 * @property {number}                   attempt           1-indexed.
 * @property {number}                   maxAttempts
 * @property {string}                   schemaDigest
 * @property {'mysql'}                  dialect
 */

/**
 * Project the schema down to the tables the plan targets. Returns
 * minimal column/PK info — same shape used by `sqlContext.js` so the
 * LLM consumes a stable structure across both prompts.
 *
 * @param {SchemaContext} schemaContext
 * @param {string[]} tableNames
 */
const projectTables = (schemaContext, tableNames) => {
  const out = [];
  for (const name of tableNames) {
    const t = schemaContext.tables[name];
    if (!t) continue;
    out.push({
      name: t.name,
      columns: Object.values(t.columns).map((c) => ({
        name: c.name,
        type: c.type,
      })),
      primaryKey: t.primaryKey.slice(),
    });
  }
  return out;
};

/**
 * @param {SchemaContext} schemaContext
 * @param {string[]} tables
 * @returns {Record<string, string[]>}
 */
const projectAllowedColumns = (schemaContext, tables) => {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const t of tables) {
    const cols = schemaContext.allowedColumns[t];
    if (cols) out[t] = cols.slice();
  }
  return out;
};

/**
 * Build the compact correction context. Pure / deterministic.
 *
 * @param {{
 *   request: QueryRequest,
 *   plan: QueryPlan,
 *   schemaContext: SchemaContext,
 *   sqlDraft: SqlDraft,
 *   validation: ValidationResult,
 *   correctionAttempts?: number,
 *   maxAttempts?: number,
 * }} args
 * @returns {CorrectionContext}
 */
export const buildCorrectionContext = ({
  request,
  plan,
  schemaContext,
  sqlDraft,
  validation,
  correctionAttempts = 0,
  maxAttempts = 2,
}) => {
  if (!request || typeof request.question !== 'string') {
    throw new Error('buildCorrectionContext requires request.question');
  }
  if (!plan) {
    throw new Error('buildCorrectionContext requires plan');
  }
  if (!schemaContext) {
    throw new Error('buildCorrectionContext requires schemaContext');
  }
  if (!sqlDraft) {
    throw new Error('buildCorrectionContext requires sqlDraft');
  }
  if (!validation) {
    throw new Error('buildCorrectionContext requires validation');
  }

  const focusTables =
    Array.isArray(plan.targetTables) && plan.targetTables.length > 0
      ? plan.targetTables.filter((t) => t in schemaContext.tables)
      : schemaContext.allowedTables.slice();

  const tables = projectTables(schemaContext, focusTables);
  const allowedColumns = projectAllowedColumns(schemaContext, focusTables);
  const schemaDigest = buildSqlSchemaDigest(schemaContext, focusTables);

  // Keep only the structured fields of each issue — no AST handles, no
  // unbounded blobs.
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  const validationIssues = issues.map((i) => ({
    code: i.code,
    message: i.message,
    severity: i.severity,
    meta: i.meta ?? {},
  }));

  return {
    dialect: 'mysql',
    question: request.question,
    plan,
    failedSql: sqlDraft.sql,
    validationIssues,
    allowedTables: focusTables.slice(),
    allowedColumns,
    tables,
    metricDefinitions: Array.isArray(plan.metricDefinitions)
      ? plan.metricDefinitions.slice()
      : [],
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.slice() : [],
    attempt: correctionAttempts + 1,
    maxAttempts,
    schemaDigest,
  };
};

export const __test = { projectTables, projectAllowedColumns };
