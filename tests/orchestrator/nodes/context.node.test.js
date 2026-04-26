import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createContextNode } from '../../../apps/api/src/orchestrator/nodes/context.node.js';
import { createPlanNode } from '../../../apps/api/src/orchestrator/nodes/plan.node.js';
import { AGENT_STATUS } from '../../../apps/api/src/utils/constants.js';

const tenant = {
  brandId: 'BRAND',
  database: 'tenant_db',
  host: 'h',
  port: 3306,
  poolKey: 'BRAND:h:3306:tenant_db',
  credentials: { user: 'u', password: 'p' },
};

const baseState = (overrides = {}) => ({
  correlationId: 'c1',
  request: { brandId: 'BRAND', question: 'cancellation rate today?', context: { userId: 'u1', conversationId: 'cv1' } },
  tenant,
  status: AGENT_STATUS.SCHEMA_LOADED,
  ...overrides,
});

/**
 * Build a minimal mock loader that returns whatever the test needs
 * without spinning up the real provider chain.
 *
 * @param {{ chatContext?: { previousQuestions?: string[], confirmedMetricDefinitions?: Record<string,string> }, metrics?: Record<string, { formula?: string, description?: string, synonyms?: string[] }> }} [opts]
 */
const makeLoader = ({ chatContext = {}, metrics = {} } = {}) => ({
  load: async () => ({
    chatContext: {
      previousQuestions: chatContext.previousQuestions ?? [],
      confirmedMetricDefinitions: chatContext.confirmedMetricDefinitions ?? {},
      lastUsedFilters: [],
      lastResultSummary: null,
      lastMetricRefs: [],
      lastFilterRefs: [],
    },
    globalContext: {
      metrics,
      glossary: {},
      synonyms: {},
    },
    retrievalContext: {
      vectorCandidates: [],
      resolvedMetricIds: Object.keys(metrics),
      source: Object.keys(metrics).length > 0 ? 'catalog' : 'none',
      debug: { mockChatMemory: true, mockVector: true, topK: 5 },
    },
  }),
});

describe('context.node — load_context', () => {
  it('attaches chatContext + globalContext + retrievalContext to state', async () => {
    const node = createContextNode({
      loader: makeLoader({
        chatContext: { previousQuestions: ['hi'] },
        metrics: { aov: { formula: 'g/o' } },
      }),
    });
    const patch = await node(baseState());
    assert.equal(patch.status, AGENT_STATUS.CONTEXT_LOADED);
    assert.deepEqual(patch.chatContext.previousQuestions, ['hi']);
    assert.equal(patch.globalContext.metrics.aov.formula, 'g/o');
    assert.equal(patch.retrievalContext.source, 'catalog');
  });

  it('throws when state.request is missing', async () => {
    const node = createContextNode({ loader: makeLoader() });
    /** @type {any} */
    const state = { ...baseState(), request: undefined };
    await assert.rejects(() => node(state), /request/);
  });

  it('throws when state.tenant is missing', async () => {
    const node = createContextNode({ loader: makeLoader() });
    /** @type {any} */
    const state = { ...baseState(), tenant: undefined };
    await assert.rejects(() => node(state), /tenant/);
  });

  it('produces patch shape that flows directly into the planner (mock mode)', async () => {
    const ctxNode = createContextNode({
      loader: makeLoader({
        chatContext: { confirmedMetricDefinitions: { cancellation_rate: 'A/B' } },
        metrics: { cancellation_rate: { formula: 'A/B' } },
      }),
    });
    const ctxPatch = await ctxNode(baseState());

    // The planner runs in mock mode — it doesn't actually read
    // globalContext, but it must accept state with these new fields
    // attached without error.
    const planNode = createPlanNode({ mode: 'mock' });
    const stateWithCtx = { ...baseState(), ...ctxPatch };
    const planPatch = await planNode(stateWithCtx);
    assert.equal(planPatch.status, AGENT_STATUS.PLANNED);
  });
});

describe('context.node — graph wiring', () => {
  it('graph order has load_context between load_schema and planner', async () => {
    const { compiledGraph } = await import('../../../apps/api/src/orchestrator/graph.js');
    const graph = compiledGraph.getGraph();
    /** @type {Record<string, string[]>} */
    const adj = {};
    for (const e of graph.edges) {
      const from = e.source ?? e.from;
      const to = e.target ?? e.to;
      if (!adj[from]) adj[from] = [];
      adj[from].push(to);
    }
    assert.ok(adj['load_schema']?.includes('load_context'));
    assert.ok(adj['load_context']?.includes('planner'));
    assert.ok(!adj['load_schema']?.includes('planner'), 'load_schema must not skip load_context');
  });
});
