import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Set required env BEFORE the controller imports so env.js doesn't
// throw on missing TENANT_ROUTER_URL.
process.env.TENANT_ROUTER_URL = 'http://tenant-router:3004';
process.env.GATEWAY_TRUST_BYPASS = 'true';

describe('insight.controller — buildResponseFromState (clarification path)', () => {
  /** @type {typeof import('../../apps/api/src/controllers/insight.controller.js').buildResponseFromState} */
  let buildResponseFromState;

  before(async () => {
    ({ buildResponseFromState } = await import(
      '../../apps/api/src/controllers/insight.controller.js'
    ));
  });

  it('returns the clarification envelope when plan.status === "needs_clarification"', () => {
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      plan: {
        intent: 'metric_calculation',
        targetTables: [],
        requiredMetrics: ['cancellation_rate'],
        status: 'needs_clarification',
        clarificationQuestion:
          'How should cancellation rate be calculated: cancelled orders / total orders, or cancelled revenue / gross revenue?',
        assumptions: [],
        metricDefinitions: [],
      },
      // execution is intentionally undefined — graph short-circuited.
      status: 'clarification_required',
    };

    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.equal(response.ok, true);
    assert.equal(response.correlationId, 'c1');
    assert.equal(result.ok, false);
    assert.equal(result.type, 'clarification_required');
    assert.match(result.question, /cancellation/i);
    assert.deepEqual(result.plan.requiredMetrics, ['cancellation_rate']);
    assert.equal(result.plan.intent, 'metric_calculation');
    // Critical: no execution data leaks through when SQL/validate/execute
    // never ran. The frontend can rely on `result.type` to branch.
    assert.equal(result.rows, undefined);
    assert.equal(result.columns, undefined);
    assert.equal(result.stats, undefined);
  });

  it('returns the execution envelope when plan.status === "ready"', () => {
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      plan: {
        intent: 'analytics_query',
        targetTables: ['gross_summary'],
        requiredMetrics: ['gross_sales'],
        status: 'ready',
        clarificationQuestion: null,
        assumptions: [],
        metricDefinitions: [],
      },
      execution: {
        ok: true,
        columns: ['date', 'gross_sales'],
        rows: [{ date: '2025-01-01', gross_sales: 100 }],
        stats: { rowCount: 1, elapsedMs: 5, truncated: false },
      },
      status: 'executed',
    };

    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.equal(response.ok, true);
    assert.equal(result.ok, true);
    assert.equal(result.columns.length, 2);
    assert.equal(result.rows.length, 1);
    // Should NOT be the clarification shape.
    assert.equal(result.type, undefined);
    assert.equal(result.question, undefined);
  });

  it('does not crash when log is omitted', () => {
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      plan: {
        intent: 'metric_calculation',
        targetTables: [],
        requiredMetrics: ['x'],
        status: 'needs_clarification',
        clarificationQuestion: 'q?',
        assumptions: [],
        metricDefinitions: [],
      },
      status: 'clarification_required',
    };
    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.equal(result.type, 'clarification_required');
  });
});
