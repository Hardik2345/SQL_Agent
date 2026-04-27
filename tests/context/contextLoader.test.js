import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { createContextLoader } from '../../apps/api/src/modules/context/contextLoader.js';
import { _internal as embedInternal } from '../../apps/api/src/modules/vector/embeddingService.js';
import { _internal as vecInternal } from '../../apps/api/src/modules/vector/vectorClient.js';
import { _internal as memInternal } from '../../apps/api/src/modules/chatMemory/chatMemoryProvider.js';
import {
  createInMemorySemanticCatalog,
} from '../../apps/api/src/modules/semantic/semanticProvider.js';
import { extractMemoryFromPlan } from '../../apps/api/src/modules/chatMemory/memoryExtractor.js';

const tenant = {
  brandId: 'BRAND',
  database: 'tenant_db',
  host: 'h',
  port: 3306,
  poolKey: 'BRAND:h:3306:tenant_db',
  credentials: { user: 'u', password: 'p' },
};

const seedMetrics = [
  {
    metricId: 'cancellation_rate',
    tenantId: 'BRAND',
    formula: 'cancelled_orders / total_orders',
    description: 'Cancellation rate',
    synonyms: ['cancel rate'],
  },
  {
    metricId: 'aov',
    tenantId: 'BRAND',
    formula: 'gross_sales / order_count',
    description: 'Average order value',
  },
];

/**
 * Build a fully-mocked context loader with seeded metrics and
 * matching vector points. Returns the loader plus the underlying
 * mocks so individual tests can manipulate them.
 */
const buildLoader = async ({ candidateIds = ['cancellation_rate', 'aov'] } = {}) => {
  const embedding = embedInternal.makeDeterministicEmbedding(32);
  const vector = vecInternal.createInMemoryVectorClient(embedding);
  const semantic = createInMemorySemanticCatalog(seedMetrics);
  const chatMemory = memInternal.createInMemoryChatMemoryProvider({ ttlSeconds: 60 });

  // Upsert one vector point per candidate so the in-memory similarity
  // search returns deterministic hits.
  await vector.upsertPoints(
    await Promise.all(
      candidateIds.map(async (metricId, i) => ({
        id: `m${i}`,
        vector: await embedding.embedText(`metric ${metricId}`),
        payload: { metricId, tenantId: 'BRAND', type: 'metric' },
      })),
    ),
  );

  const loader = createContextLoader({ chatMemory, semantic, vector, topK: 5 });
  return { loader, chatMemory, semantic, vector };
};

describe('contextLoader — hybrid retrieval', () => {
  it('produces empty grounding when chat memory + vector are empty', async () => {
    const embedding = embedInternal.makeDeterministicEmbedding(32);
    const loader = createContextLoader({
      chatMemory: memInternal.createInMemoryChatMemoryProvider({ ttlSeconds: 60 }),
      semantic: createInMemorySemanticCatalog(),
      vector: vecInternal.createInMemoryVectorClient(embedding),
    });
    const out = await loader.load({
      request: { brandId: 'BRAND', question: 'how many orders today?' },
      tenant,
    });
    assert.deepEqual(out.globalContext.metrics, {});
    assert.deepEqual(out.chatContext.previousQuestions, []);
    assert.equal(out.retrievalContext.source, 'none');
  });

  it('builds globalContext.metrics from vector → catalog round-trip', async () => {
    const { loader } = await buildLoader();
    const out = await loader.load({
      request: { brandId: 'BRAND', question: 'metric cancellation_rate' },
      tenant,
    });
    assert.ok(out.globalContext.metrics.cancellation_rate);
    assert.equal(
      out.globalContext.metrics.cancellation_rate.formula,
      'cancelled_orders / total_orders',
    );
    assert.ok(Array.isArray(out.retrievalContext.vectorCandidates));
    assert.ok(out.retrievalContext.vectorCandidates.length > 0);
    assert.ok(out.retrievalContext.resolvedMetricIds.includes('cancellation_rate'));
    assert.equal(out.retrievalContext.source, 'vector');
  });

  it('chat memory is preserved and surfaces in chatContext', async () => {
    const { loader, chatMemory } = await buildLoader();
    await chatMemory.updateChatContext({
      brandId: 'BRAND',
      userId: 'u1',
      conversationId: 'conv-1',
      memoryDelta: {
        previousQuestions: ['how many orders?'],
        confirmedMetricDefinitions: { cancellation_rate: 'cancelled_revenue / gross_revenue' },
      },
    });
    const out = await loader.load({
      request: { brandId: 'BRAND', question: 'cancellation rate today?' },
      tenant,
      userId: 'u1',
      conversationId: 'conv-1',
    });
    assert.equal(out.chatContext.previousQuestions[0], 'how many orders?');
    assert.equal(
      out.chatContext.confirmedMetricDefinitions.cancellation_rate,
      'cancelled_revenue / gross_revenue',
    );
    assert.equal(out.retrievalContext.source, 'hybrid');
  });

  it('vector failures are non-fatal — semantic catalog still works', async () => {
    const embedding = embedInternal.makeDeterministicEmbedding(32);
    const semantic = createInMemorySemanticCatalog(seedMetrics);
    const chatMemory = memInternal.createInMemoryChatMemoryProvider({ ttlSeconds: 60 });
    const vector = {
      mock: true,
      searchSimilarMetrics: async () => {
        throw new Error('boom');
      },
      upsertPoints: async () => {},
      clear: async () => {},
    };
    const loader = createContextLoader({ chatMemory, semantic, vector });
    const out = await loader.load({
      request: { brandId: 'BRAND', question: 'q' },
      tenant,
    });
    // No vector candidates → no metric resolution from this path,
    // but call still succeeds.
    assert.deepEqual(out.globalContext.metrics, {});
    assert.equal(out.retrievalContext.source, 'none');
  });

  it('throws when request.question is missing', async () => {
    const { loader } = await buildLoader();
    await assert.rejects(
      () => loader.load({
        request: /** @type {any} */ ({ brandId: 'BRAND' }),
        tenant,
      }),
      /question/,
    );
  });

  it('throws when tenant.brandId is missing', async () => {
    const { loader } = await buildLoader();
    await assert.rejects(
      () => loader.load({
        request: { brandId: 'BRAND', question: 'q' },
        tenant: /** @type {any} */ ({}),
      }),
      /brandId/,
    );
  });
});

describe('memoryExtractor', () => {
  const request = { brandId: 'BRAND', question: 'how many orders per day?' };
  /** @type {import('../../apps/api/src/modules/contracts/queryPlan.js').QueryPlan} */
  const plan = {
    intent: 'metric_over_time',
    targetTables: ['orders'],
    requiredMetrics: ['order_count'],
    resultShape: 'time_series',
    dimensions: ['date'],
    filters: ['status = paid'],
    timeGrain: 'day',
    notes: '',
    status: 'ready',
    clarificationQuestion: null,
    assumptions: ['defaulted to last 30 days'],
    metricDefinitions: [
      { name: 'order_count', formula: 'COUNT(*)', source: 'global_context' },
      { name: 'cancellation_rate', formula: 'cancelled / total', source: 'chat_context' },
      { name: 'aov', formula: 'g/o', source: 'planner_assumption' },
    ],
  };
  const result = {
    ok: true,
    columns: ['day', 'order_count'],
    rows: [],
    stats: { rowCount: 30, elapsedMs: 5, truncated: false },
  };

  it('records the question, metric refs, and filter refs', () => {
    const delta = extractMemoryFromPlan({ request, plan, result });
    assert.deepEqual(delta.previousQuestions, ['how many orders per day?']);
    assert.deepEqual(delta.lastMetricRefs, ['order_count']);
    assert.equal(delta.lastFilterRefs.length, 1);
    assert.equal(delta.lastFilterRefs[0].text, 'status = paid');
  });

  it('persists ONLY chat-confirmed metric definitions (skips global / planner_assumption)', () => {
    const delta = extractMemoryFromPlan({ request, plan, result });
    assert.deepEqual(delta.confirmedMetricDefinitions, {
      cancellation_rate: 'cancelled / total',
    });
  });

  it('writes a structural result summary (rowCount + truncated only — no rows, no SQL)', () => {
    const delta = extractMemoryFromPlan({ request, plan, result });
    assert.equal(delta.lastResultSummary, 'rows=30; truncated=false');
  });

  it('does not include SQL anywhere in the delta', () => {
    const delta = extractMemoryFromPlan({ request, plan, result });
    const serialized = JSON.stringify(delta);
    assert.ok(!serialized.toUpperCase().includes('SELECT'));
    assert.ok(!serialized.toUpperCase().includes('FROM '));
  });

  it('result undefined → no lastResultSummary written', () => {
    const delta = extractMemoryFromPlan({ request, plan, result: null });
    assert.equal(delta.lastResultSummary, undefined);
  });
});
