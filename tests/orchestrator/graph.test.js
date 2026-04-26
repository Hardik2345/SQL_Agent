import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { assertAgentState } from '../../apps/api/src/modules/contracts/agentState.js';
import { initialState } from '../../apps/api/src/orchestrator/state.js';
import { AGENT_STATUS } from '../../apps/api/src/utils/constants.js';
import { loadSchemaNode } from '../../apps/api/src/orchestrator/nodes/schema.node.js';
import { planNode } from '../../apps/api/src/orchestrator/nodes/plan.node.js';
import { sqlNode } from '../../apps/api/src/orchestrator/nodes/sql.node.js';
import { validateNode } from '../../apps/api/src/orchestrator/nodes/validate.node.js';
import { schemaCache } from '../../apps/api/src/modules/schema/schemaCache.js';

const tenant = {
  brandId: 'brand_1',
  database: 'brand_1_db',
  host: '127.0.0.1',
  port: 3306,
  shardId: 'shard-1',
  poolKey: 'brand_1:127.0.0.1:3306:brand_1_db',
  credentials: { user: 'u', password: 'p' },
};

const request = { brandId: 'brand_1', question: 'How many orders per day?' };

describe('orchestrator nodes', () => {
  before(() => {
    // Ensure each test run starts with a clean schema cache so tests
    // don't depend on prior runs' state.
    schemaCache.clear();
  });

  it('initialState builds a valid AgentState', () => {
    const state = initialState({ correlationId: 'c1', request, tenant });
    const validated = assertAgentState(state);
    assert.equal(validated.status, AGENT_STATUS.PENDING);
  });

  it('loadSchemaNode attaches a SchemaContext from the dump', async () => {
    const state = initialState({ correlationId: 'c1', request, tenant });
    const patch = await loadSchemaNode(state);
    assert.ok(patch.schemaContext);
    assert.equal(patch.status, AGENT_STATUS.SCHEMA_LOADED);
    assert.equal(patch.schemaContext.dialect, 'mysql');
    assert.equal(patch.schemaContext.source, 'schema_dump');
    assert.ok(patch.schemaContext.allowedTables.length > 0);
    // Tenant database is propagated for observability.
    assert.equal(patch.schemaContext.database, tenant.database);
  });

  it('planNode produces a QueryPlan', async () => {
    const state = initialState({ correlationId: 'c1', request, tenant });
    const patch = await planNode(state);
    assert.ok(patch.plan);
    assert.equal(patch.status, AGENT_STATUS.PLANNED);
    assert.ok(Array.isArray(patch.plan.targetTables));
    assert.ok(patch.plan.targetTables.length > 0);
  });

  it('sqlNode produces an SqlDraft from a plan', async () => {
    // Phase 2B-B: sqlNode now requires schemaContext as well as a
    // plan, so seed the state via loadSchemaNode first.
    const base = initialState({ correlationId: 'c1', request, tenant });
    const withSchema = { ...base, ...(await loadSchemaNode(base)) };
    const withPlan = { ...withSchema, ...(await planNode(withSchema)) };
    const patch = await sqlNode(withPlan);
    assert.ok(patch.sqlDraft);
    assert.equal(patch.sqlDraft.dialect, 'mysql');
    assert.equal(patch.status, AGENT_STATUS.SQL_DRAFTED);
  });

  it('validateNode accepts the mocked SQL draft against the real schema', async () => {
    const base = initialState({ correlationId: 'c1', request, tenant });
    const withSchema = { ...base, ...(await loadSchemaNode(base)) };
    const withPlan = { ...withSchema, ...(await planNode(withSchema)) };
    const withDraft = { ...withPlan, ...(await sqlNode(withPlan)) };
    const patch = await validateNode(withDraft);
    assert.equal(patch.status, AGENT_STATUS.VALIDATED);
    assert.equal(patch.validation.valid, true, JSON.stringify(patch.validation?.issues));
  });

  it('validateNode throws when state.schemaContext is missing', async () => {
    const base = initialState({ correlationId: 'c1', request, tenant });
    /** @type {any} */
    const withoutSchema = {
      ...base,
      plan: { intent: 'x', targetTables: ['gross_summary'], requiredMetrics: [] },
      sqlDraft: {
        sql: 'SELECT `date` FROM `gross_summary` LIMIT 1',
        dialect: 'mysql',
        tables: ['gross_summary'],
      },
    };
    await assert.rejects(
      () => validateNode(withoutSchema),
      /schemaContext/,
    );
  });

  it('validateNode returns invalid result on DML draft (Phase 2C: no longer throws)', async () => {
    // Phase 2C semantics: validate is no longer the place that throws
    // on invalid SQL. Instead, the conditional `validationRouter` in
    // graph.js routes invalid drafts to either correction or END.
    // This test confirms the node returns the failing ValidationResult
    // so the router has something to inspect.
    const base = initialState({ correlationId: 'c1', request, tenant });
    const withSchema = { ...base, ...(await loadSchemaNode(base)) };
    /** @type {any} */
    const bad = {
      ...withSchema,
      plan: { intent: 'x', targetTables: ['gross_summary'], requiredMetrics: [] },
      sqlDraft: {
        sql: 'DELETE FROM gross_summary',
        dialect: 'mysql',
        tables: ['gross_summary'],
      },
    };
    const patch = await validateNode(bad);
    assert.equal(patch.status, AGENT_STATUS.VALIDATED);
    assert.equal(patch.validation.valid, false);
    assert.ok(
      patch.validation.issues.some((i) => i.severity === 'error'),
      'expected at least one error-severity issue',
    );
  });
});

describe('compiled graph', () => {
  it('wires START -> load_schema -> plan -> generate_sql -> validate -> execute -> END', async () => {
    const { compiledGraph } = await import('../../apps/api/src/orchestrator/graph.js');
    // LangGraph exposes the underlying graph via `getGraph()` on the
    // compiled object. Read its node + edge lists and confirm the order.
    const graph = compiledGraph.getGraph();
    const nodeIds = Object.keys(graph.nodes);
    // The planner node is registered as `planner` (not `plan`) to avoid
    // a name collision with the `plan` state channel — see the comment
    // in apps/api/src/utils/constants.js. The conceptual graph order
    // (load_schema -> plan -> generate_sql -> validate -> execute) is
    // unchanged.
    for (const expected of ['load_schema', 'load_context', 'planner', 'generate_sql', 'validate', 'correct', 'execute']) {
      assert.ok(nodeIds.includes(expected), `missing node ${expected}; got ${nodeIds.join(',')}`);
    }

    /** @type {Record<string, string[]>} */
    const adj = {};
    for (const e of graph.edges) {
      const from = e.source ?? e.from;
      const to = e.target ?? e.to;
      if (!adj[from]) adj[from] = [];
      adj[from].push(to);
    }
    assert.ok(adj['__start__']?.includes('load_schema'), `expected __start__ -> load_schema, adj=${JSON.stringify(adj)}`);
    // Phase 2D: load_context runs between load_schema and planner.
    assert.ok(adj['load_schema']?.includes('load_context'));
    assert.ok(adj['load_context']?.includes('planner'));
    assert.ok(adj['planner']?.includes('generate_sql'));
    assert.ok(adj['generate_sql']?.includes('validate'));
    // Phase 2C: validate fans out to execute (success), correct (retry), or END (exhausted).
    assert.ok(adj['validate']?.includes('execute'));
    assert.ok(adj['validate']?.includes('correct'));
    assert.ok(adj['validate']?.includes('__end__'));
    assert.ok(adj['correct']?.includes('validate'), 'correct must loop back to validate');
    assert.ok(adj['execute']?.includes('__end__'));
  });
});
