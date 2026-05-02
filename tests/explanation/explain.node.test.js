import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.TENANT_ROUTER_URL = 'http://tenant-router:3004';
process.env.GATEWAY_TRUST_BYPASS = 'true';

const request = { brandId: 'TMC', question: 'Show orders by day' };
/** @type {import('../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
const plan = {
  intent: 'metric_over_time',
  targetTables: ['orders'],
  requiredMetrics: ['orders'],
  resultShape: 'time_series',
  dimensions: ['date'],
  filters: ['last 30 days'],
  status: 'ready',
  clarificationQuestion: null,
  assumptions: [],
  metricDefinitions: [],
};
const execution = {
  ok: true,
  columns: ['date', 'orders'],
  rows: Array.from({ length: 7 }, (_, idx) => ({ date: `2026-04-${idx + 1}`, orders: idx })),
  stats: { rowCount: 7, elapsedMs: 20, truncated: false },
};

describe('explain.node', () => {
  let mod;

  before(async () => {
    mod = await import('../../apps/api/src/orchestrator/nodes/explain.node.js');
  });

  it('mock mode returns stable table_result output', async () => {
    const node = mod.createExplainNode({ mode: 'mock' });
    const patch = await node({ correlationId: 'c1', request, plan, execution });

    assert.equal(patch.explanation.type, 'table_result');
    assert.equal(patch.explanation.headline, 'Query executed successfully');
    assert.equal(patch.explanation.summary, 'Returned 7 rows.');
    assert.deepEqual(patch.explanation.keyPoints, []);
    assert.deepEqual(patch.explanation.caveats, []);
    assert.deepEqual(patch.explanation.suggestedVisualization, { type: 'table' });
    assert.equal(patch.explanation.confidence, 1);
  });

  it('llm mode parses and validates a good explanation', async () => {
    const llm = {
      invokeJson: async () => ({
        type: 'mixed',
        headline: 'Daily orders are available',
        summary: 'The result contains daily order rows.',
        keyPoints: ['Data spans multiple rows'],
        caveats: [],
        suggestedVisualization: { type: 'line', x: 'date', y: 'orders' },
        confidence: 0.8,
      }),
    };
    const node = mod.createExplainNode({ mode: 'llm', llm });
    const patch = await node({ correlationId: 'c1', request, plan, execution });

    assert.equal(patch.explanation.type, 'mixed');
    assert.equal(patch.explanation.suggestedVisualization.type, 'line');
  });

  it('llm prompt receives at most five sample rows and no SQL', async () => {
    /** @type {Array<{ role: string, content: string }> | null} */
    let captured = null;
    const llm = {
      invokeJson: async (messages) => {
        captured = messages;
        return {
          type: 'table_result',
          headline: 'Rows returned',
          summary: 'Rows were returned.',
          keyPoints: [],
          caveats: [],
          suggestedVisualization: { type: 'table' },
        };
      },
    };
    const node = mod.createExplainNode({ mode: 'llm', llm });
    await node({
      correlationId: 'c1',
      request,
      plan,
      execution,
      sqlDraft: { sql: 'SELECT secret_sql FROM table', dialect: 'mysql', tables: ['table'] },
    });

    assert.ok(captured);
    const userMessage = captured[1].content;
    const json = JSON.parse(userMessage.match(/Explanation context:\n([\s\S]*?)\n\nReturn ONLY/)[1]);
    assert.equal(json.sampleRows.length, 5);
    assert.equal(userMessage.includes('SELECT secret_sql'), false);
    assert.equal(userMessage.includes('credentials'), false);
  });

  it('missing execution throws a ContractError', async () => {
    const node = mod.createExplainNode({ mode: 'mock' });
    await assert.rejects(
      () => node({ correlationId: 'c1', request, plan }),
      (err) => err instanceof Error && err.name === 'ContractError' && /execution/.test(err.message),
    );
  });
});
