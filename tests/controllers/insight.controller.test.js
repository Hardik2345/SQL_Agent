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
      explanation: {
        type: 'mixed',
        headline: 'Sales by day',
        summary: 'One sales row was returned.',
        keyPoints: [],
        caveats: [],
        suggestedVisualization: { type: 'table' },
        confidence: 1,
      },
      status: 'executed',
    };

    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.equal(response.ok, true);
    assert.equal(result.ok, true);
    assert.equal(result.columns.length, 2);
    assert.equal(result.rows.length, 1);
    assert.equal(result.explanation.headline, 'Sales by day');
    // Should NOT be the clarification shape.
    assert.equal(result.type, undefined);
    assert.equal(result.question, undefined);
  });

  it('responseMode="table" omits explanation while preserving rows', () => {
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      request: { context: { responseMode: 'table' } },
      plan: { status: 'ready' },
      execution: {
        ok: true,
        columns: ['gross_sales'],
        rows: [{ gross_sales: 100 }],
        stats: { rowCount: 1, elapsedMs: 5, truncated: false },
      },
      explanation: {
        type: 'text_insight',
        headline: 'Gross sales',
        summary: 'Gross sales were returned.',
        keyPoints: [],
        caveats: [],
      },
    };

    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.deepEqual(result.columns, ['gross_sales']);
    assert.equal(result.rows.length, 1);
    assert.equal(result.explanation, undefined);
  });

  it('responseMode="insight" returns explanation only', () => {
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      request: { context: { responseMode: 'insight' } },
      plan: { status: 'ready' },
      execution: {
        ok: true,
        columns: ['gross_sales'],
        rows: [{ gross_sales: 100 }],
        stats: { rowCount: 1, elapsedMs: 5, truncated: false },
      },
      explanation: {
        type: 'text_insight',
        headline: 'Gross sales',
        summary: 'Gross sales were returned.',
        keyPoints: [],
        caveats: [],
      },
    };

    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.equal(result.ok, true);
    assert.equal(result.explanation.headline, 'Gross sales');
    assert.equal(result.columns, undefined);
    assert.equal(result.rows, undefined);
    assert.equal(result.stats, undefined);
  });

  it('returns the memory acknowledgement envelope when plan.status === "memory_update"', () => {
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      plan: {
        intent: 'chat_metric_definition',
        targetTables: [],
        requiredMetrics: [],
        status: 'memory_update',
        clarificationQuestion: null,
        assumptions: [],
        metricDefinitions: [],
        memoryUpdates: {
          confirmedMetricDefinitions: {
            contribution_margin: 'net sales - discounts',
          },
        },
      },
      status: 'memory_update_required',
    };

    const response = buildResponseFromState(state, 'c1');
    const result = /** @type {any} */ (response.result);
    assert.equal(response.ok, true);
    assert.equal(result.ok, true);
    assert.equal(result.type, 'memory_ack');
    assert.equal(
      result.confirmedMetricDefinitions.contribution_margin,
      'net sales - discounts',
    );
    assert.equal(result.rows, undefined);
  });

  it('emits the E_VALIDATION envelope when validation failed and correction was exhausted (Phase 2C)', async () => {
    const { buildResponseFromState, httpStatusForState } = await import(
      '../../apps/api/src/controllers/insight.controller.js'
    );

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
      sqlDraft: { sql: 'SELECT bad_col FROM gross_summary', dialect: 'mysql', tables: ['gross_summary'] },
      validation: {
        valid: false,
        issues: [
          {
            code: 'V_COLUMN_NOT_ALLOWED',
            message: 'Column not allowed on table gross_summary: bad_col',
            severity: 'error',
            meta: { table: 'gross_summary', column: 'bad_col' },
          },
        ],
      },
      // No execution — graph routed straight to END after correction exhausted.
      correctionAttempts: 2,
      correctionHistory: [
        { attempt: 1, issues: [], previousSql: 'SELECT a', correctedSql: 'SELECT b', mode: 'mock' },
        { attempt: 2, issues: [], previousSql: 'SELECT b', correctedSql: 'SELECT c', mode: 'mock' },
      ],
      status: 'validated',
    };

    const response = buildResponseFromState(state, 'c1');
    assert.equal(response.ok, false);
    assert.equal(response.correlationId, 'c1');
    assert.equal(response.error.code, 'E_VALIDATION');
    assert.match(response.error.message, /validation/i);
    const details = /** @type {any} */ (response.error.details);
    assert.equal(details.issues.length, 1);
    assert.equal(details.issues[0].code, 'V_COLUMN_NOT_ALLOWED');
    assert.equal(details.correctionAttempts, 2);
    assert.equal(details.correctionHistory.length, 2);

    // HTTP status helper pairs to 422.
    assert.equal(httpStatusForState(state), 422);
  });

  it('still returns 200 + execution envelope when validation passed', async () => {
    const { httpStatusForState } = await import(
      '../../apps/api/src/controllers/insight.controller.js'
    );
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      plan: { status: 'ready' },
      validation: { valid: true, issues: [] },
      execution: { ok: true, columns: [], rows: [], stats: { rowCount: 0, elapsedMs: 1, truncated: false } },
    };
    assert.equal(httpStatusForState(state), 200);
  });

  it('still returns 200 for clarification', async () => {
    const { httpStatusForState } = await import(
      '../../apps/api/src/controllers/insight.controller.js'
    );
    /** @type {any} */
    const state = {
      correlationId: 'c1',
      plan: { status: 'needs_clarification', clarificationQuestion: 'q?', requiredMetrics: [] },
    };
    assert.equal(httpStatusForState(state), 200);
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
