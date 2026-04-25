import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { assertAgentState } from '../../apps/api/src/modules/contracts/agentState.js';
import { initialState } from '../../apps/api/src/orchestrator/state.js';
import { AGENT_STATUS } from '../../apps/api/src/utils/constants.js';
import { loadSchemaNode } from '../../apps/api/src/orchestrator/nodes/schema.node.js';
import { planNode } from '../../apps/api/src/orchestrator/nodes/plan.node.js';
import { sqlNode } from '../../apps/api/src/orchestrator/nodes/sql.node.js';
import { validateNode } from '../../apps/api/src/orchestrator/nodes/validate.node.js';
import { ValidationError } from '../../apps/api/src/utils/errors.js';
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

  it('validateNode throws on DML draft', async () => {
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
    await assert.rejects(
      () => validateNode(bad),
      (err) => err instanceof ValidationError,
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
    for (const expected of ['load_schema', 'planner', 'generate_sql', 'validate', 'execute']) {
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
    assert.ok(adj['load_schema']?.includes('planner'));
    assert.ok(adj['planner']?.includes('generate_sql'));
    assert.ok(adj['generate_sql']?.includes('validate'));
    assert.ok(adj['validate']?.includes('execute'));
    assert.ok(adj['execute']?.includes('__end__'));
  });
});
