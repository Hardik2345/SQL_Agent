import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertQueryPlan } from '../../apps/api/src/modules/contracts/queryPlan.js';
import { ContractError } from '../../apps/api/src/utils/errors.js';

describe('QueryPlan contract — Phase 2B widening', () => {
  it('accepts the new full shape (status, clarificationQuestion, assumptions, metricDefinitions)', () => {
    const plan = assertQueryPlan({
      intent: 'metric_over_time',
      targetTables: ['gross_summary'],
      requiredMetrics: ['gross_sales'],
      filters: ['last 30 days'],
      timeGrain: 'day',
      notes: 'ok',
      status: 'ready',
      clarificationQuestion: null,
      assumptions: ['defaulted time range to last 30 days'],
      metricDefinitions: [
        {
          name: 'gross_sales',
          formula: 'SUM(gross_sales)',
          description: 'Sum of gross sales over the period',
          source: 'global_context',
        },
      ],
    });
    assert.equal(plan.status, 'ready');
    assert.equal(plan.clarificationQuestion, null);
    assert.equal(plan.assumptions.length, 1);
    assert.equal(plan.metricDefinitions.length, 1);
    assert.equal(plan.metricDefinitions[0].source, 'global_context');
  });

  it('normalizes a minimal/legacy plan to defaults (status=ready, empty arrays, null clarification)', () => {
    const plan = assertQueryPlan({
      intent: 'analytics_query',
      targetTables: ['gross_summary'],
      requiredMetrics: ['gross_sales'],
    });
    assert.equal(plan.status, 'ready');
    assert.equal(plan.clarificationQuestion, null);
    assert.deepEqual(plan.assumptions, []);
    assert.deepEqual(plan.metricDefinitions, []);
  });

  it('accepts status="needs_clarification" with empty targetTables and a clarificationQuestion', () => {
    const plan = assertQueryPlan({
      intent: 'metric_calculation',
      targetTables: [],
      requiredMetrics: ['cancellation_rate'],
      filters: [],
      notes: 'cancellation_rate definition not provided',
      status: 'needs_clarification',
      clarificationQuestion:
        'How should cancellation rate be calculated: cancelled orders / total orders, or cancelled revenue / gross revenue?',
      assumptions: [],
      metricDefinitions: [],
    });
    assert.equal(plan.status, 'needs_clarification');
    assert.equal(plan.targetTables.length, 0);
    assert.match(plan.clarificationQuestion, /cancelled/i);
  });

  it('rejects status="ready" with empty targetTables (cross-rule)', () => {
    assert.throws(
      () =>
        assertQueryPlan({
          intent: 'analytics_query',
          targetTables: [],
          requiredMetrics: ['x'],
          status: 'ready',
        }),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects status="needs_clarification" without a clarificationQuestion', () => {
    assert.throws(
      () =>
        assertQueryPlan({
          intent: 'metric_calculation',
          targetTables: [],
          requiredMetrics: ['x'],
          status: 'needs_clarification',
          clarificationQuestion: null,
        }),
      (err) => err instanceof ContractError,
    );
  });

  it('rejects an invalid metricDefinitions[].source', () => {
    assert.throws(
      () =>
        assertQueryPlan({
          intent: 'metric_calculation',
          targetTables: ['gross_summary'],
          requiredMetrics: ['m'],
          metricDefinitions: [
            { name: 'm', source: 'something_else' },
          ],
        }),
      (err) => err instanceof ContractError,
    );
  });

  it('preserves a clarificationQuestion of empty string as a contract failure', () => {
    // Empty string is not a useful clarification — guard against it.
    assert.throws(
      () =>
        assertQueryPlan({
          intent: 'metric_calculation',
          targetTables: [],
          requiredMetrics: ['x'],
          status: 'needs_clarification',
          clarificationQuestion: '',
        }),
      (err) => err instanceof ContractError,
    );
  });
});
