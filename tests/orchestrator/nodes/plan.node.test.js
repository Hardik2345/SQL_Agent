import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { createPlanNode } from '../../../apps/api/src/orchestrator/nodes/plan.node.js';
import { AGENT_STATUS } from '../../../apps/api/src/utils/constants.js';
import { ContractError } from '../../../apps/api/src/utils/errors.js';
import { schemaCache } from '../../../apps/api/src/modules/schema/schemaCache.js';
import { getSchemaContext } from '../../../apps/api/src/modules/schema/schemaProvider.js';

const tenant = {
  brandId: 'BRAND',
  database: 'tenant_db',
  host: '127.0.0.1',
  port: 3306,
  poolKey: 'BRAND:127.0.0.1:3306:tenant_db',
  credentials: { user: 'u', password: 'p' },
};

const baseState = (schemaContext, question = 'How many gross sales per day?') => ({
  correlationId: 'c1',
  request: { brandId: 'BRAND', question },
  tenant,
  schemaContext,
  status: AGENT_STATUS.SCHEMA_LOADED,
});

/**
 * Build a fake LlmClient. `responder` receives the exact messages array
 * passed to `invokeJson` and returns whatever value the test wants
 * (object, array, primitive, or a promise that rejects).
 */
const makeFakeLlm = (responder) => ({
  invokeJson: async (messages) => {
    if (typeof responder === 'function') return responder(messages);
    return responder;
  },
});

describe('plan.node — mock mode', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('returns the deterministic mock plan and never calls the llm', async () => {
    let llmCalled = false;
    const llm = makeFakeLlm(() => {
      llmCalled = true;
      return {};
    });
    const plan = createPlanNode({ mode: 'mock', llm });
    const patch = await plan(baseState(schemaContext));
    assert.equal(patch.status, AGENT_STATUS.PLANNED);
    assert.deepEqual(patch.plan.targetTables, ['gross_summary']);
    assert.equal(patch.plan.intent, 'analytics_query');
    assert.equal(llmCalled, false);
    assert.ok(!('sql' in patch.plan), 'mock plan must not include a sql field');
  });

  it('mock plan carries the Phase 2B widened shape (status=ready, defaults)', async () => {
    const llm = makeFakeLlm({});
    const plan = createPlanNode({ mode: 'mock', llm });
    const patch = await plan(baseState(schemaContext));
    assert.equal(patch.plan.status, 'ready');
    assert.equal(patch.plan.clarificationQuestion, null);
    assert.deepEqual(patch.plan.assumptions, []);
    assert.deepEqual(patch.plan.metricDefinitions, []);
  });
});

describe('plan.node — llm mode (structured output)', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('parses a well-formed LLM response into a QueryPlan', async () => {
    const llm = makeFakeLlm({
      intent: 'metric_over_time',
      targetTables: ['gross_summary'],
      requiredMetrics: ['gross_sales'],
      filters: ['last 30 days'],
      timeGrain: 'day',
      notes: 'Defaulted time range to last 30 days because question did not specify.',
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    const patch = await plan(baseState(schemaContext));
    assert.equal(patch.status, AGENT_STATUS.PLANNED);
    assert.equal(patch.plan.intent, 'metric_over_time');
    assert.deepEqual(patch.plan.targetTables, ['gross_summary']);
    assert.equal(patch.plan.timeGrain, 'day');
    assert.match(patch.plan.notes, /30 days/);
  });

  it('strips forbidden SQL-bearing keys before validation', async () => {
    const llm = makeFakeLlm({
      intent: 'metric_over_time',
      targetTables: ['gross_summary'],
      requiredMetrics: ['gross_sales'],
      filters: [],
      timeGrain: 'day',
      notes: 'ok',
      sql: 'SELECT * FROM gross_summary',
      query: 'DROP TABLE x',
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    const patch = await plan(baseState(schemaContext));
    assert.ok(!('sql' in patch.plan), 'sql key must be stripped from the plan');
    assert.ok(!('query' in patch.plan), 'query key must be stripped');
  });

  it('passes schemaContext into the prompt sent to the LLM', async () => {
    /** @type {Array<{role: string, content: string}>|null} */
    let captured = null;
    const llm = makeFakeLlm((messages) => {
      captured = messages;
      return {
        intent: 'metric_over_time',
        targetTables: ['gross_summary'],
        requiredMetrics: ['gross_sales'],
        filters: [],
        timeGrain: 'day',
        notes: 'ok',
      };
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    await plan(baseState(schemaContext));

    assert.ok(captured && captured.length === 2, 'expected system + user messages');
    const system = captured[0];
    const user = captured[1];
    assert.equal(system.role, 'system');
    assert.equal(user.role, 'user');

    // The user message must contain the schema digest with at least one
    // real table name from the dump and the question itself.
    assert.match(user.content, /Question: How many gross sales per day\?/);
    assert.match(user.content, /\bgross_summary\b/);
    assert.match(user.content, /\bdiscount_summary\b/);
    // Column types should be rendered in the digest format.
    assert.match(user.content, /date\(date\)/);

    // The system prompt must forbid SQL generation.
    assert.match(system.content, /No SQL/i);
    assert.match(system.content, /JSON only/i);
  });

  it('fails with ContractError when LLM returns invalid JSON shape (missing required fields)', async () => {
    const llm = makeFakeLlm({ intent: 'metric_over_time' /* missing targetTables, requiredMetrics */ });
    const plan = createPlanNode({ mode: 'llm', llm });
    await assert.rejects(
      () => plan(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('fails with ContractError when LLM throws (e.g., non-JSON output)', async () => {
    const llm = {
      invokeJson: async () => {
        throw new Error('LLM returned non-JSON content (role=planner): unexpected token');
      },
    };
    const plan = createPlanNode({ mode: 'llm', llm });
    await assert.rejects(
      () => plan(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('fails with ContractError when LLM returns a non-object (array)', async () => {
    const llm = makeFakeLlm([{ intent: 'x' }]);
    const plan = createPlanNode({ mode: 'llm', llm });
    await assert.rejects(
      () => plan(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('the produced plan never contains an sql key', async () => {
    const llm = makeFakeLlm({
      intent: 'metric_over_time',
      targetTables: ['gross_summary'],
      requiredMetrics: ['gross_sales'],
      filters: [],
      timeGrain: 'day',
      notes: 'ok',
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    const patch = await plan(baseState(schemaContext));
    const planAsRecord = /** @type {Record<string, unknown>} */ (patch.plan);
    assert.equal(planAsRecord.sql, undefined);
    assert.equal(planAsRecord.query, undefined);
  });

  it('throws clearly when state.schemaContext is missing in llm mode', async () => {
    const llm = makeFakeLlm({});
    const plan = createPlanNode({ mode: 'llm', llm });
    /** @type {any} */
    const stateNoSchema = {
      correlationId: 'c1',
      request: { brandId: 'BRAND', question: 'x' },
      tenant,
      status: AGENT_STATUS.PENDING,
    };
    await assert.rejects(() => plan(stateNoSchema), /schemaContext/);
  });
});

describe('plan.node — Phase 2B clarification handling', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('returns needs_clarification when LLM cannot resolve cancellation_rate without context', async () => {
    const llm = makeFakeLlm({
      intent: 'metric_calculation',
      targetTables: [],
      requiredMetrics: ['cancellation_rate'],
      filters: [],
      timeGrain: null,
      notes: 'Cancellation rate has no provided formula and is ambiguous.',
      status: 'needs_clarification',
      clarificationQuestion:
        'How should cancellation rate be calculated: cancelled orders / total orders, or cancelled revenue / gross revenue?',
      assumptions: [],
      metricDefinitions: [],
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    const patch = await plan(
      baseState(schemaContext, 'What is the cancellation rate for today?'),
    );
    assert.equal(patch.plan.status, 'needs_clarification');
    assert.equal(patch.status, AGENT_STATUS.CLARIFICATION_REQUIRED);
    assert.match(patch.plan.clarificationQuestion, /cancelled/i);
    assert.deepEqual(patch.plan.targetTables, []);
  });

  it('returns ready when cancellation_rate formula is in globalContext', async () => {
    /** @type {Array<{role:string, content:string}> | null} */
    let captured = null;
    const llm = makeFakeLlm((messages) => {
      captured = messages;
      return {
        intent: 'metric_calculation',
        targetTables: ['gross_summary'],
        requiredMetrics: ['cancellation_rate'],
        filters: [],
        timeGrain: 'day',
        notes: 'Used cancellation_rate formula from global_context.',
        status: 'ready',
        clarificationQuestion: null,
        assumptions: [],
        metricDefinitions: [
          {
            name: 'cancellation_rate',
            formula: 'cancelled_orders / total_orders',
            description: 'cancelled / total orders',
            source: 'global_context',
          },
        ],
      };
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    const state = baseState(schemaContext, 'What is the cancellation rate today?');
    state.globalContext = {
      metrics: {
        cancellation_rate: {
          formula: 'cancelled_orders / total_orders',
          description: 'Ratio of cancelled to total orders.',
        },
      },
    };
    const patch = await plan(state);
    assert.equal(patch.plan.status, 'ready');
    assert.equal(patch.status, AGENT_STATUS.PLANNED);
    assert.equal(patch.plan.metricDefinitions[0].source, 'global_context');

    // The user message must include the global-context formula so the
    // LLM has the grounding it needs to produce a `ready` plan.
    const userMessage = captured.find((m) => m.role === 'user');
    assert.match(userMessage.content, /Known metric definitions/);
    assert.match(userMessage.content, /cancelled_orders \/ total_orders/);
  });

  it('chat-confirmed metric definition supersedes the global one in the prompt', async () => {
    /** @type {Array<{role:string, content:string}> | null} */
    let captured = null;
    const llm = makeFakeLlm((messages) => {
      captured = messages;
      return {
        intent: 'metric_calculation',
        targetTables: ['gross_summary'],
        requiredMetrics: ['cancellation_rate'],
        filters: [],
        timeGrain: 'day',
        notes: 'Used chat-confirmed cancellation_rate formula.',
        status: 'ready',
        clarificationQuestion: null,
        assumptions: [],
        metricDefinitions: [
          {
            name: 'cancellation_rate',
            formula: 'cancelled_revenue / gross_revenue',
            source: 'chat_context',
          },
        ],
      };
    });
    const plan = createPlanNode({ mode: 'llm', llm });
    const state = baseState(schemaContext, 'cancellation rate today');
    state.globalContext = {
      metrics: {
        cancellation_rate: {
          formula: 'cancelled_orders / total_orders',
        },
      },
    };
    state.chatContext = {
      confirmedMetricDefinitions: {
        cancellation_rate: 'cancelled_revenue / gross_revenue',
      },
    };
    await plan(state);
    const userMessage = captured.find((m) => m.role === 'user');
    // chat-confirmed formula should appear; original global formula
    // should be superseded in the merged knownMetrics block.
    assert.match(userMessage.content, /cancelled_revenue \/ gross_revenue/);
  });
});

describe('plan.node — graph routing of needs_clarification', () => {
  it('planRouter sends terminal planner statuses to END and ready to generate_sql', async () => {
    const { planRouter } = await import('../../../apps/api/src/orchestrator/graph.js');
    const { END } = await import('@langchain/langgraph');
    assert.equal(planRouter({ plan: { status: 'needs_clarification' } }), END);
    assert.equal(planRouter({ plan: { status: 'memory_update' } }), END);
    assert.equal(planRouter({ plan: { status: 'ready' } }), 'generate_sql');
    // Defensive: missing plan should NOT route to clarification.
    assert.equal(planRouter({}), 'generate_sql');
  });
});
