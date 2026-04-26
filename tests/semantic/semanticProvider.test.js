import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInMemorySemanticCatalog,
  createSemanticProvider,
  metricsToGlobalContext,
} from '../../apps/api/src/modules/semantic/semanticProvider.js';

const SEED = [
  {
    metricId: 'cancellation_rate',
    tenantId: 'BRAND',
    formula: 'cancelled_orders / total_orders',
    description: 'Cancellation rate by orders',
    synonyms: ['cancel rate', 'cxr'],
    tables: ['orders'],
    columns: ['cancelled_orders', 'total_orders'],
  },
  {
    metricId: 'aov',
    tenantId: 'BRAND',
    formula: 'gross_sales / order_count',
    description: 'Average order value',
    synonyms: ['average order value'],
  },
  {
    metricId: 'aov',
    tenantId: 'OTHER',
    formula: 'net_sales / order_count',
    description: 'Average order value (other tenant)',
  },
];

describe('semanticProvider — in-memory catalog', () => {
  /** @type {ReturnType<typeof createInMemorySemanticCatalog>} */
  let catalog;
  beforeEach(() => {
    catalog = createInMemorySemanticCatalog(SEED);
  });

  it('getMetricsByIds returns matching tenant-scoped entries', async () => {
    const out = await catalog.getMetricsByIds(['cancellation_rate', 'aov'], 'BRAND');
    assert.equal(out.length, 2);
    const aov = out.find((m) => m.metricId === 'aov');
    assert.equal(aov.formula, 'gross_sales / order_count');
  });

  it('getMetricsByIds is tenant-scoped — never returns another brand', async () => {
    const out = await catalog.getMetricsByIds(['aov'], 'BRAND');
    assert.equal(out.length, 1);
    assert.match(out[0].formula, /gross_sales/);
  });

  it('getMetricsByIds returns [] for unknown ids', async () => {
    const out = await catalog.getMetricsByIds(['phantom'], 'BRAND');
    assert.deepEqual(out, []);
  });

  it('getMetricsBySynonym matches metricId or synonyms (case-insensitive)', async () => {
    const out = await catalog.getMetricsBySynonym('Cancel Rate', 'BRAND');
    assert.equal(out.length, 1);
    assert.equal(out[0].metricId, 'cancellation_rate');
  });

  it('metricsToGlobalContext produces the planner-compatible shape', () => {
    // The function is a pure projection — tenant filtering is the
    // caller's job (the context loader filters by `tenantId` before
    // it ever calls this). Pass only BRAND-scoped metrics here so
    // the test isn't sensitive to seed iteration order.
    const brandOnly = SEED.filter((m) => m.tenantId === 'BRAND');
    const gc = metricsToGlobalContext(brandOnly);
    assert.equal(gc.cancellation_rate.formula, 'cancelled_orders / total_orders');
    assert.deepEqual(gc.cancellation_rate.synonyms, ['cancel rate', 'cxr']);
    assert.equal(gc.aov.formula, 'gross_sales / order_count');
  });
});

describe('createSemanticProvider — env-driven default', () => {
  it('falls back to an in-memory catalog when MONGO_URI is unset', async () => {
    /** @type {any} */
    const p = await createSemanticProvider({ uri: '' });
    // The in-memory catalog exposes upsert/clear/size; the Mongo
    // variant does not. Use that as the discriminator.
    assert.equal(typeof p.upsert, 'function');
    assert.equal(p.size(), 0);
  });
});
