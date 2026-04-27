import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSqlContext,
  buildSqlSchemaDigest,
} from '../../apps/api/src/modules/sql/sqlContext.js';

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
        total: { name: 'total', type: 'decimal(12,2)', nullable: false, defaultValue: '0', isPrimaryKey: false, isForeignKey: false, references: null },
      },
      primaryKey: ['id'],
      foreignKeys: [],
    },
    customers: {
      name: 'customers',
      columns: {
        id: { name: 'id', type: 'bigint', nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, references: null },
        email: { name: 'email', type: 'varchar(320)', nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
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
  allowedTables: ['orders', 'customers', 'unrelated'],
  allowedColumns: {
    orders: ['id', 'status', 'total'],
    customers: ['id', 'email'],
    unrelated: ['x'],
  },
  allowedJoins: [],
};

/** @type {import('../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
const samplePlan = {
  intent: 'metric_over_time',
  targetTables: ['orders'],
  requiredMetrics: ['total_orders', 'gross_sales'],
  resultShape: 'time_series',
  dimensions: ['date'],
  filters: ['status = paid'],
  timeGrain: 'day',
  notes: 'paid orders only',
  status: 'ready',
  clarificationQuestion: null,
  assumptions: ['Time range defaulted to last 30 days'],
  metricDefinitions: [
    {
      name: 'gross_sales',
      formula: 'SUM(total)',
      description: 'Sum of order totals',
      source: 'global_context',
    },
  ],
};

describe('buildSqlContext', () => {
  it('includes question, plan, and dialect', () => {
    const ctx = buildSqlContext({
      request: { brandId: 'B', question: 'How many paid orders per day?' },
      plan: samplePlan,
      schemaContext,
    });
    assert.equal(ctx.question, 'How many paid orders per day?');
    assert.equal(ctx.dialect, 'mysql');
    assert.deepEqual(ctx.plan, samplePlan);
  });

  it('passes through metricDefinitions and assumptions from the plan', () => {
    const ctx = buildSqlContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
    });
    assert.equal(ctx.metricDefinitions.length, 1);
    assert.equal(ctx.metricDefinitions[0].formula, 'SUM(total)');
    assert.equal(ctx.assumptions.length, 1);
    assert.match(ctx.assumptions[0], /30 days/);
  });

  it('scopes tables / allowedColumns / digest to plan.targetTables only', () => {
    const ctx = buildSqlContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
    });
    assert.deepEqual(ctx.allowedTables, ['orders']);
    assert.deepEqual(Object.keys(ctx.allowedColumns), ['orders']);
    assert.equal(ctx.tables.length, 1);
    assert.equal(ctx.tables[0].name, 'orders');
    // Unrelated tables MUST NOT leak into the digest.
    assert.ok(!ctx.schemaDigest.includes('unrelated'));
    assert.ok(!ctx.schemaDigest.includes('customers'));
    assert.match(ctx.schemaDigest, /orders: id\(bigint\), status\(varchar\(50\)\), total\(decimal\(12,2\)\)/);
  });

  it('includes column types in the projected tables list', () => {
    const ctx = buildSqlContext({
      request: { brandId: 'B', question: 'q' },
      plan: { ...samplePlan, targetTables: ['orders', 'customers'] },
      schemaContext,
    });
    const ordersTable = ctx.tables.find((t) => t.name === 'orders');
    const customersTable = ctx.tables.find((t) => t.name === 'customers');
    assert.deepEqual(
      ordersTable.columns.map((c) => `${c.name}:${c.type}`).sort(),
      ['id:bigint', 'status:varchar(50)', 'total:decimal(12,2)'],
    );
    assert.deepEqual(
      customersTable.columns.map((c) => c.name).sort(),
      ['email', 'id'],
    );
    assert.deepEqual(ordersTable.primaryKey, ['id']);
  });

  it('falls back to all allowedTables when targetTables is empty (defensive)', () => {
    const ctx = buildSqlContext({
      request: { brandId: 'B', question: 'q' },
      plan: { ...samplePlan, targetTables: [] },
      schemaContext,
    });
    // Defensive fallback — should not normally happen for ready plans.
    assert.deepEqual(ctx.allowedTables.sort(), ['customers', 'orders', 'unrelated']);
  });

  it('does not include credentials, tenant route metadata, or raw schema dump', () => {
    const ctx = buildSqlContext({
      request: { brandId: 'B', question: 'q' },
      plan: samplePlan,
      schemaContext,
    });
    const serialized = JSON.stringify(ctx);
    // No tenant credentials should ever appear.
    assert.ok(!serialized.includes('password'));
    assert.ok(!serialized.includes('credentials'));
    // No tenant routing metadata.
    assert.ok(!serialized.includes('rds_proxy'));
    assert.ok(!serialized.includes('poolKey'));
    // No raw `CREATE TABLE` dump-style content.
    assert.ok(!serialized.includes('CREATE TABLE'));
    assert.ok(!serialized.includes('ENGINE=InnoDB'));
  });

  it('throws when the request question is missing', () => {
    assert.throws(
      () =>
        buildSqlContext({
          request: /** @type {any} */ ({ brandId: 'B' }),
          plan: samplePlan,
          schemaContext,
        }),
      /question/,
    );
  });

  it('throws when plan is missing', () => {
    assert.throws(
      () =>
        buildSqlContext({
          request: { brandId: 'B', question: 'q' },
          plan: /** @type {any} */ (null),
          schemaContext,
        }),
      /plan/,
    );
  });

  it('throws when schemaContext is missing', () => {
    assert.throws(
      () =>
        buildSqlContext({
          request: { brandId: 'B', question: 'q' },
          plan: samplePlan,
          schemaContext: /** @type {any} */ (null),
        }),
      /schemaContext/,
    );
  });
});

describe('buildSqlSchemaDigest', () => {
  it('renders only the requested tables', () => {
    const digest = buildSqlSchemaDigest(schemaContext, ['orders']);
    assert.match(digest, /^orders: /);
    assert.ok(!digest.includes('customers'));
    assert.ok(!digest.includes('unrelated'));
  });

  it('skips unknown tables silently rather than throwing', () => {
    const digest = buildSqlSchemaDigest(schemaContext, ['orders', 'phantom']);
    assert.match(digest, /orders/);
    assert.ok(!digest.includes('phantom'));
  });

  it('falls back to all allowedTables when targets are empty', () => {
    const digest = buildSqlSchemaDigest(schemaContext, []);
    assert.match(digest, /orders:/);
    assert.match(digest, /customers:/);
    assert.match(digest, /unrelated:/);
  });
});
