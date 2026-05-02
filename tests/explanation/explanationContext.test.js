import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildExplanationContext } from '../../apps/api/src/modules/explanation/explanationContext.js';

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

describe('buildExplanationContext', () => {
  it('uses only lightweight execution context and caps sampleRows at five', () => {
    const execution = {
      ok: true,
      columns: ['date', 'orders'],
      rows: Array.from({ length: 9 }, (_, idx) => ({ date: `2026-04-${idx + 1}`, orders: idx })),
      stats: { rowCount: 9, elapsedMs: 12, truncated: false },
    };

    const ctx = buildExplanationContext({ request, plan, execution });

    assert.equal(ctx.question, request.question);
    assert.equal(ctx.intent, 'metric_over_time');
    assert.deepEqual(ctx.metrics, ['orders']);
    assert.deepEqual(ctx.filters, ['last 30 days']);
    assert.equal(ctx.rowCount, 9);
    assert.equal(ctx.truncated, false);
    assert.deepEqual(ctx.columns, ['date', 'orders']);
    assert.equal(ctx.sampleRows.length, 5);
    assert.equal(JSON.stringify(ctx).includes('SELECT'), false);
    assert.equal(Object.hasOwn(ctx, 'sql'), false);
    assert.equal(Object.hasOwn(ctx, 'credentials'), false);
  });
});
