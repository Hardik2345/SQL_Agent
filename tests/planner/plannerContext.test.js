import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlannerContext } from '../../apps/api/src/modules/planner/plannerContext.js';

/** @type {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext} */
const minimalSchemaContext = {
  dialect: 'mysql',
  source: 'test',
  database: null,
  tables: {
    orders: {
      name: 'orders',
      columns: {
        id: { name: 'id', type: 'bigint', nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, references: null },
        status: { name: 'status', type: 'varchar(50)', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
      },
      primaryKey: ['id'],
      foreignKeys: [],
    },
  },
  allowedTables: ['orders'],
  allowedColumns: { orders: ['id', 'status'] },
  allowedJoins: [],
};

/** @type {import('../../apps/api/src/modules/schema/schema.types.js').SchemaContext} */
const curatedSchemaContext = {
  ...minimalSchemaContext,
  tables: {
    ...minimalSchemaContext.tables,
    shopify_orders: {
      name: 'shopify_orders',
      columns: {
        order_id: { name: 'order_id', type: 'varchar(50)', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
        product_id: { name: 'product_id', type: 'varchar(50)', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
        financial_status: { name: 'financial_status', type: 'varchar(50)', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
        created_at: { name: 'created_at', type: 'datetime', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
      },
      primaryKey: [],
      foreignKeys: [],
    },
    gross_summary: {
      name: 'gross_summary',
      columns: {
        date: { name: 'date', type: 'date', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
        gross_sales: { name: 'gross_sales', type: 'float', nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, references: null },
      },
      primaryKey: [],
      foreignKeys: [],
    },
  },
  allowedTables: ['orders', 'shopify_orders', 'gross_summary'],
  allowedColumns: {
    orders: ['id', 'status'],
    shopify_orders: ['order_id', 'product_id', 'financial_status', 'created_at'],
    gross_summary: ['date', 'gross_sales'],
  },
};

describe('buildPlannerContext', () => {
  it('produces question + schema digest from minimal inputs', () => {
    const ctx = buildPlannerContext({
      request: { brandId: 'B', question: 'how many orders?' },
      schemaContext: minimalSchemaContext,
    });
    assert.equal(ctx.question, 'how many orders?');
    assert.match(ctx.schemaDigest, /orders: id\(bigint\), status\(varchar\(50\)\)/);
    assert.deepEqual(ctx.knownMetrics, {});
    assert.deepEqual(ctx.glossary, {});
    assert.deepEqual(ctx.previousQuestions, []);
    assert.deepEqual(ctx.confirmedDefinitions, {});
  });

  it('curates planner schema to the analytics table surface when available', () => {
    const ctx = buildPlannerContext({
      request: { brandId: 'B', question: 'cancellation rate for product 1' },
      schemaContext: curatedSchemaContext,
    });

    assert.match(ctx.schemaDigest, /^shopify_orders:/);
    assert.match(ctx.schemaDigest, /grain=order line item/);
    assert.match(ctx.schemaDigest, /COUNT\(DISTINCT order_id\)/);
    assert.ok(!ctx.schemaDigest.includes('gross_summary:'));
    assert.doesNotMatch(ctx.schemaDigest, /^orders:/m);
  });

  it('merges global metric definitions with chat confirmations (chat wins on conflict)', () => {
    const ctx = buildPlannerContext({
      request: { brandId: 'B', question: 'q' },
      schemaContext: minimalSchemaContext,
      globalContext: {
        metrics: {
          cancellation_rate: {
            formula: 'cancelled_orders / total_orders',
            description: 'global default',
            synonyms: ['cancel rate'],
          },
          aov: { formula: 'gross_sales / order_count' },
        },
      },
      chatContext: {
        confirmedMetricDefinitions: {
          cancellation_rate: 'cancelled_revenue / gross_revenue',
        },
      },
    });

    assert.equal(ctx.knownMetrics.cancellation_rate.source, 'chat_context');
    assert.equal(ctx.knownMetrics.cancellation_rate.formula, 'cancelled_revenue / gross_revenue');
    assert.equal(ctx.knownMetrics.aov.source, 'global_context');
    assert.equal(ctx.knownMetrics.aov.formula, 'gross_sales / order_count');
  });

  it('folds globalContext.synonyms into glossary without overwriting glossary entries', () => {
    const ctx = buildPlannerContext({
      request: { brandId: 'B', question: 'q' },
      schemaContext: minimalSchemaContext,
      globalContext: {
        glossary: { 'cogs': 'cost of goods sold' },
        synonyms: { 'cogs': 'inventory cost', 'aov': 'average order value' },
      },
    });
    assert.equal(ctx.glossary.cogs, 'cost of goods sold'); // glossary precedence
    assert.equal(ctx.glossary.aov, 'average order value');
  });

  it('caps previousQuestions at the most recent 5', () => {
    const ctx = buildPlannerContext({
      request: { brandId: 'B', question: 'q' },
      chatContext: {
        previousQuestions: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
      },
    });
    assert.deepEqual(ctx.previousQuestions, ['q3', 'q4', 'q5', 'q6', 'q7']);
  });

  it('does not include credentials or tenant route data', () => {
    const ctx = buildPlannerContext({
      request: { brandId: 'B', question: 'how many orders?' },
      schemaContext: minimalSchemaContext,
      globalContext: { metrics: {} },
      chatContext: {},
    });
    const serialized = JSON.stringify(ctx);
    assert.ok(!serialized.includes('password'));
    assert.ok(!serialized.includes('credentials'));
    assert.ok(!serialized.includes('rds_proxy'));
    assert.ok(!serialized.includes('poolKey'));
  });

  it('throws when question is missing', () => {
    assert.throws(
      () => buildPlannerContext({ request: /** @type {any} */ ({ brandId: 'B' }) }),
      /question/,
    );
  });
});
