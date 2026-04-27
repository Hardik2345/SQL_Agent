import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { createSqlNode } from '../../../apps/api/src/orchestrator/nodes/sql.node.js';
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

/**
 * Build a fake LLM that records its inputs (when given a function
 * responder) or simply returns a fixed payload (when given a value).
 */
const makeFakeLlm = (responder) => ({
  invokeJson: async (messages) => {
    if (typeof responder === 'function') return responder(messages);
    return responder;
  },
});

/** @type {import('../../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
const readyPlan = {
  intent: 'metric_over_time',
  targetTables: ['gross_summary'],
  requiredMetrics: ['gross_sales'],
  resultShape: 'time_series',
  dimensions: ['date'],
  filters: [],
  timeGrain: 'day',
  notes: 'ok',
  status: 'ready',
  clarificationQuestion: null,
  assumptions: [],
  metricDefinitions: [],
};

const baseState = (schemaContext, plan = readyPlan) => ({
  correlationId: 'c1',
  request: { brandId: 'BRAND', question: 'sales by day' },
  tenant,
  schemaContext,
  plan,
  status: AGENT_STATUS.PLANNED,
});

describe('sql.node — mock mode', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('returns the deterministic gross_summary draft and never calls the llm', async () => {
    let llmCalled = false;
    const llm = makeFakeLlm(() => {
      llmCalled = true;
      return {};
    });
    const node = createSqlNode({ mode: 'mock', llm });
    const patch = await node(baseState(schemaContext));
    assert.equal(patch.status, AGENT_STATUS.SQL_DRAFTED);
    assert.equal(patch.sqlDraft.dialect, 'mysql');
    assert.deepEqual(patch.sqlDraft.tables, ['gross_summary']);
    assert.match(patch.sqlDraft.sql, /FROM `gross_summary`/);
    assert.equal(llmCalled, false);
  });
});

describe('sql.node — llm mode (structured output)', () => {
  let schemaContext;
  before(async () => {
    schemaCache.clear();
    schemaContext = await getSchemaContext({ tenant });
  });

  it('parses a well-formed LLM SqlDraft response', async () => {
    const llm = makeFakeLlm({
      sql: 'SELECT `date`, SUM(`gross_sales`) AS total FROM `gross_summary` GROUP BY `date` ORDER BY `date` DESC LIMIT 30',
      dialect: 'mysql',
      tables: ['gross_summary'],
      rationale: 'Daily gross sales over time',
    });
    const node = createSqlNode({ mode: 'llm', llm });
    const patch = await node(baseState(schemaContext));
    assert.equal(patch.status, AGENT_STATUS.SQL_DRAFTED);
    assert.equal(patch.sqlDraft.dialect, 'mysql');
    assert.match(patch.sqlDraft.sql, /SELECT/);
    assert.deepEqual(patch.sqlDraft.tables, ['gross_summary']);
    assert.match(patch.sqlDraft.rationale, /Daily gross/);
  });

  it('strips a single trailing semicolon from the LLM SQL', async () => {
    const llm = makeFakeLlm({
      sql: 'SELECT `date` FROM `gross_summary` LIMIT 1;',
      dialect: 'mysql',
      tables: ['gross_summary'],
    });
    const node = createSqlNode({ mode: 'llm', llm });
    const patch = await node(baseState(schemaContext));
    assert.ok(!patch.sqlDraft.sql.endsWith(';'), `expected no trailing ';' got: ${patch.sqlDraft.sql}`);
    assert.match(patch.sqlDraft.sql, /^SELECT/);
  });

  it('passes question, plan, schema digest, and metricDefinitions into the prompt', async () => {
    /** @type {Array<{role:string, content:string}> | null} */
    let captured = null;
    const llm = makeFakeLlm((messages) => {
      captured = messages;
      return {
        sql: 'SELECT 1 AS one FROM `gross_summary` LIMIT 1',
        dialect: 'mysql',
        tables: ['gross_summary'],
      };
    });
    const node = createSqlNode({ mode: 'llm', llm });
    /** @type {import('../../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
    const planWithMetric = {
      ...readyPlan,
      metricDefinitions: [
        {
          name: 'cancellation_rate',
          formula: 'cancelled_orders / total_orders',
          source: 'global_context',
        },
      ],
      assumptions: ['Time range defaulted to last 30 days'],
    };
    await node(baseState(schemaContext, planWithMetric));

    assert.ok(captured && captured.length === 2, 'expected system + user messages');
    const [system, user] = captured;
    assert.equal(system.role, 'system');
    assert.equal(user.role, 'user');
    // System prompt must forbid SQL-shaped output beyond the contract.
    assert.match(system.content, /JSON only/i);
    assert.match(system.content, /No DDL/i);
    // User message must carry the question, plan JSON, and schema digest.
    assert.match(user.content, /Question: sales by day/);
    assert.match(user.content, /"intent": "metric_over_time"/);
    assert.match(user.content, /\bgross_summary\b/);
    assert.match(user.content, /Metric definitions to implement EXACTLY/);
    assert.match(user.content, /cancelled_orders \/ total_orders/);
    assert.match(user.content, /Time range defaulted to last 30 days/);
  });

  it('rejects when state.request is missing', async () => {
    const llm = makeFakeLlm({});
    const node = createSqlNode({ mode: 'llm', llm });
    /** @type {any} */
    const state = { ...baseState(schemaContext), request: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects when state.plan is missing', async () => {
    const llm = makeFakeLlm({});
    const node = createSqlNode({ mode: 'llm', llm });
    /** @type {any} */
    const state = { ...baseState(schemaContext), plan: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('rejects when state.schemaContext is missing', async () => {
    const llm = makeFakeLlm({});
    const node = createSqlNode({ mode: 'llm', llm });
    /** @type {any} */
    const state = { ...baseState(schemaContext), schemaContext: undefined };
    await assert.rejects(() => node(state), (err) => err instanceof ContractError);
  });

  it('refuses to compile a plan with status="needs_clarification"', async () => {
    const llm = makeFakeLlm({});
    const node = createSqlNode({ mode: 'llm', llm });
    /** @type {import('../../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
    const clarificationPlan = {
      ...readyPlan,
      status: 'needs_clarification',
      clarificationQuestion: 'How should X be defined?',
      targetTables: [],
    };
    await assert.rejects(
      () => node(baseState(schemaContext, clarificationPlan)),
      (err) => err instanceof ContractError && /needs_clarification/.test(err.message),
    );
  });

  it('rejects empty SQL via assertSqlDraft (the prompt failure-mode path)', async () => {
    const llm = makeFakeLlm({
      sql: '',
      dialect: 'mysql',
      tables: [],
      rationale: 'Cannot implement plan against the provided schema',
    });
    const node = createSqlNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects a non-mysql dialect', async () => {
    const llm = makeFakeLlm({
      sql: 'SELECT 1',
      dialect: 'postgres',
      tables: ['gross_summary'],
    });
    const node = createSqlNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects an LLM response missing the required fields', async () => {
    const llm = makeFakeLlm({ sql: 'SELECT 1' /* dialect, tables missing */ });
    const node = createSqlNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects a non-object LLM response (array)', async () => {
    const llm = makeFakeLlm([{ sql: 'SELECT 1' }]);
    const node = createSqlNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('wraps LLM transport errors in ContractError', async () => {
    const llm = {
      invokeJson: async () => {
        throw new Error('network blip');
      },
    };
    const node = createSqlNode({ mode: 'llm', llm });
    await assert.rejects(
      () => node(baseState(schemaContext)),
      (err) => err instanceof ContractError,
    );
  });

  it('factory injection: createSqlNode({ mode, llm }) honours both arguments', async () => {
    // mode defaults to env, but explicit mode='mock' should never call llm.
    let mockLlmCalled = false;
    const mockNode = createSqlNode({
      mode: 'mock',
      llm: { invokeJson: async () => { mockLlmCalled = true; return {}; } },
    });
    await mockNode(baseState(schemaContext));
    assert.equal(mockLlmCalled, false);

    // explicit mode='llm' uses the injected client without env reads.
    let llmInvoked = false;
    const llmNode = createSqlNode({
      mode: 'llm',
      llm: {
        invokeJson: async () => {
          llmInvoked = true;
          return {
            sql: 'SELECT `date` FROM `gross_summary` LIMIT 1',
            dialect: 'mysql',
            tables: ['gross_summary'],
          };
        },
      },
    });
    await llmNode(baseState(schemaContext));
    assert.equal(llmInvoked, true);
  });
});
