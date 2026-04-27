import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCorrectionContext } from '../../apps/api/src/modules/correction/correctionContext.js';

/** @type {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext} */
const schemaContext = {
  dialect: 'mysql',
  source: 'test',
  database: 'tenant_db',
  tables: {
    orders: {
      name: 'orders',
      columns: {
        id: { name: 'id', type: 'bigint', nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, references: null },
        status: { name: 'status', type: 'varchar(50)', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
        created_at: { name: 'created_at', type: 'datetime', nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
      },
      primaryKey: ['id'],
      foreignKeys: [],
    },
    unrelated: {
      name: 'unrelated',
      columns: {
        x: { name: 'x', type: 'int', nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, references: null },
      },
      primaryKey: ['x'],
      foreignKeys: [],
    },
  },
  allowedTables: ['orders', 'unrelated'],
  allowedColumns: { orders: ['id', 'status', 'created_at'], unrelated: ['x'] },
  allowedJoins: [],
};

/** @type {import('../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
const samplePlan = {
  intent: 'metric_over_time',
  targetTables: ['orders'],
  requiredMetrics: ['order_count'],
  resultShape: 'time_series',
  dimensions: ['date'],
  filters: [],
  timeGrain: 'day',
  notes: 'ok',
  status: 'ready',
  clarificationQuestion: null,
  assumptions: ['Time range defaulted to last 30 days'],
  metricDefinitions: [
    { name: 'order_count', formula: 'COUNT(*)', source: 'global_context' },
  ],
};

const failingDraft = {
  sql: 'SELECT id, total_profit FROM orders LIMIT 10',
  dialect: 'mysql',
  tables: ['orders'],
  rationale: 'first attempt',
};

/** @type {import('../../apps/api/src/modules/contracts/validationResult.js').ValidationResult} */
const failedValidation = {
  valid: false,
  issues: [
    {
      code: 'V_COLUMN_NOT_ALLOWED',
      message: 'Column not allowed on table orders: total_profit',
      severity: 'error',
      meta: { table: 'orders', column: 'total_profit' },
    },
  ],
};

describe('buildCorrectionContext', () => {
  it('includes the original question, plan, and failed SQL', () => {
    const ctx = buildCorrectionContext({
      request: { brandId: 'B', question: 'how many orders today?' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
    });
    assert.equal(ctx.question, 'how many orders today?');
    assert.equal(ctx.failedSql, failingDraft.sql);
    assert.deepEqual(ctx.plan, samplePlan);
    assert.equal(ctx.dialect, 'mysql');
  });

  it('preserves V_* validation issue codes and messages', () => {
    const ctx = buildCorrectionContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
    });
    assert.equal(ctx.validationIssues.length, 1);
    assert.equal(ctx.validationIssues[0].code, 'V_COLUMN_NOT_ALLOWED');
    assert.match(ctx.validationIssues[0].message, /total_profit/);
    assert.equal(ctx.validationIssues[0].severity, 'error');
    assert.deepEqual(ctx.validationIssues[0].meta, {
      table: 'orders',
      column: 'total_profit',
    });
  });

  it('passes through metricDefinitions and assumptions from the plan', () => {
    const ctx = buildCorrectionContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
    });
    assert.equal(ctx.metricDefinitions.length, 1);
    assert.equal(ctx.metricDefinitions[0].formula, 'COUNT(*)');
    assert.equal(ctx.assumptions.length, 1);
  });

  it('scopes schema digest / tables / allowedColumns to plan.targetTables', () => {
    const ctx = buildCorrectionContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
    });
    assert.deepEqual(ctx.allowedTables, ['orders']);
    assert.deepEqual(Object.keys(ctx.allowedColumns), ['orders']);
    assert.equal(ctx.tables.length, 1);
    assert.equal(ctx.tables[0].name, 'orders');
    // unrelated table must never leak into the digest.
    assert.ok(!ctx.schemaDigest.includes('unrelated'));
    assert.match(ctx.schemaDigest, /orders: id\(bigint\)/);
  });

  it('includes attempt and maxAttempts metadata for the prompt', () => {
    const ctx = buildCorrectionContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
      correctionAttempts: 1,
      maxAttempts: 3,
    });
    assert.equal(ctx.attempt, 2);
    assert.equal(ctx.maxAttempts, 3);
  });

  it('does not include credentials, tenant routing, or raw schema dump', () => {
    const ctx = buildCorrectionContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
    });
    const serialized = JSON.stringify(ctx);
    assert.ok(!serialized.includes('password'));
    assert.ok(!serialized.includes('credentials'));
    assert.ok(!serialized.includes('rds_proxy'));
    assert.ok(!serialized.includes('poolKey'));
    assert.ok(!serialized.includes('CREATE TABLE'));
    assert.ok(!serialized.includes('ENGINE=InnoDB'));
  });

  it('throws when any required input is missing', () => {
    const base = {
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
      sqlDraft: failingDraft,
      validation: failedValidation,
    };
    for (const field of ['plan', 'schemaContext', 'sqlDraft', 'validation']) {
      const args = { ...base, [field]: null };
      assert.throws(
        () => buildCorrectionContext(/** @type {any} */ (args)),
        new RegExp(field),
      );
    }
    assert.throws(
      () =>
        buildCorrectionContext(/** @type {any} */ ({
          ...base,
          request: { brandId: 'B' },
        })),
      /question/,
    );
  });
});
