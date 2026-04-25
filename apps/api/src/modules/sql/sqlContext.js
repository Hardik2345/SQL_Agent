/**
 * SQL generator context builder.
 *
 * Compresses everything the SQL generator LLM needs to compile a plan
 * into a single JSON-serializable object. Mirrors the design of
 * `modules/planner/plannerContext.js`:
 *   - pure / deterministic / no I/O,
 *   - never includes credentials or tenant route metadata,
 *   - never includes the raw schema dump file,
 *   - keeps the schema digest scoped to the plan's `targetTables` so
 *     the prompt stays small even on large tenants (51 tables).
 *
 * The SQL generator's job is to **compile a plan**, not to plan. It
 * receives the planner's `QueryPlan` (including `metricDefinitions` and
 * `assumptions`) and a focused slice of the SchemaContext for the
 * tables the plan targets.
 *
 * @typedef {import('../contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../contracts/queryPlan.js').QueryPlan}     QueryPlan
 * @typedef {import('../contracts/queryPlan.js').MetricDefinition} MetricDefinition
 * @typedef {import('../schema/schema.types.js').SchemaContext} SchemaContext
 *
 * @typedef {Object} SqlContextTable
 * @property {string}                  name
 * @property {Array<{ name: string, type: string }>} columns
 * @property {string[]}                primaryKey
 *
 * @typedef {Object} SqlContext
 * @property {'mysql'}                  dialect
 * @property {string}                   question
 * @property {QueryPlan}                plan
 * @property {string[]}                 allowedTables
 * @property {Record<string, string[]>} allowedColumns
 * @property {SqlContextTable[]}        tables
 * @property {MetricDefinition[]}       metricDefinitions
 * @property {string[]}                 assumptions
 * @property {string}                   schemaDigest
 */

/**
 * Compact "table: col(type), …" digest. Scoped to `targetTables` when
 * provided so we don't ship the entire 51-table schema to every
 * compile request. Falls back to all `allowedTables` only when the
 * plan supplied no targets — a degenerate case for `ready` plans, but
 * we handle it defensively rather than throwing.
 *
 * @param {SchemaContext} schemaContext
 * @param {string[]} [targetTables]
 * @returns {string}
 */
export const buildSqlSchemaDigest = (schemaContext, targetTables) => {
  const list =
    targetTables && targetTables.length > 0
      ? targetTables
      : schemaContext.allowedTables;

  /** @type {string[]} */
  const lines = [];
  for (const tableName of list) {
    const t = schemaContext.tables[tableName];
    if (!t) continue;
    const colTokens = Object.values(t.columns).map(
      (c) => `${c.name}(${c.type})`,
    );
    lines.push(`${tableName}: ${colTokens.join(', ')}`);
  }
  return lines.join('\n');
};

/**
 * Project the schema down to just the tables the plan wants. Each
 * entry carries the column list (name + type only) and the primary
 * key, which is enough for the LLM to write joins, aggregates, and
 * GROUP BYs correctly without leaking unrelated tables.
 *
 * @param {SchemaContext} schemaContext
 * @param {string[]} targetTables
 * @returns {SqlContextTable[]}
 */
const projectTables = (schemaContext, targetTables) => {
  /** @type {SqlContextTable[]} */
  const out = [];
  for (const name of targetTables) {
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
 * Slice `allowedColumns` to the same scope as the projected tables.
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
 * Build the compact SQL-generator context. Pure / deterministic.
 *
 * @param {{
 *   request: QueryRequest,
 *   plan: QueryPlan,
 *   schemaContext: SchemaContext,
 * }} args
 * @returns {SqlContext}
 */
export const buildSqlContext = ({ request, plan, schemaContext }) => {
  if (!request || typeof request.question !== 'string') {
    throw new Error('buildSqlContext requires request.question');
  }
  if (!plan) {
    throw new Error('buildSqlContext requires plan');
  }
  if (!schemaContext) {
    throw new Error('buildSqlContext requires schemaContext');
  }

  // Prefer plan.targetTables; fall back to allowedTables only for
  // robustness (a `ready` plan should never reach the SQL generator
  // with empty targetTables — the QueryPlan cross-validator
  // enforces this — but a defensive fallback keeps the SQL generator
  // useful for tests and future flows).
  const focusTables =
    Array.isArray(plan.targetTables) && plan.targetTables.length > 0
      ? plan.targetTables.filter((t) => t in schemaContext.tables)
      : schemaContext.allowedTables.slice();

  const tables = projectTables(schemaContext, focusTables);
  const allowedColumns = projectAllowedColumns(schemaContext, focusTables);
  const schemaDigest = buildSqlSchemaDigest(schemaContext, focusTables);

  return {
    dialect: 'mysql',
    question: request.question,
    plan,
    allowedTables: focusTables.slice(),
    allowedColumns,
    tables,
    metricDefinitions: Array.isArray(plan.metricDefinitions)
      ? plan.metricDefinitions.slice()
      : [],
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.slice() : [],
    schemaDigest,
  };
};

/** Exposed for direct testing of the helpers. */
export const __test = { projectTables, projectAllowedColumns };
