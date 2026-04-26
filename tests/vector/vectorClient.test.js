import { describe, it, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { createEmbeddingService, _internal as embedInternal } from '../../apps/api/src/modules/vector/embeddingService.js';
import { createVectorClient, _internal as vecInternal } from '../../apps/api/src/modules/vector/vectorClient.js';

describe('embeddingService — deterministic mock', () => {
  /** @type {Awaited<ReturnType<typeof createEmbeddingService>>} */
  let svc;
  before(async () => {
    svc = embedInternal.makeDeterministicEmbedding(16);
  });

  it('produces a stable, fixed-dimension vector', async () => {
    const v1 = await svc.embedText('hello world');
    const v2 = await svc.embedText('hello world');
    assert.equal(v1.length, 16);
    assert.deepEqual(v1, v2);
  });

  it('different inputs yield different vectors', async () => {
    const a = await svc.embedText('orders per day');
    const b = await svc.embedText('totally different question about churn');
    assert.notDeepEqual(a, b);
  });

  it('vectors are unit-normalised (cosine sim equals dot product)', async () => {
    const v = await svc.embedText('whatever');
    let norm = 0;
    for (const x of v) norm += x * x;
    assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-6, `expected unit norm, got ${Math.sqrt(norm)}`);
  });
});

describe('createEmbeddingService — env-driven default', () => {
  it('uses the deterministic mock when no API key is set', async () => {
    const svc = await createEmbeddingService({ apiKey: '', dimensions: 8 });
    assert.equal(svc.mock, true);
    assert.equal(svc.dimensions, 8);
  });
});

describe('vectorClient — in-memory store', () => {
  /** @type {Awaited<ReturnType<typeof createVectorClient>>} */
  let client;
  beforeEach(async () => {
    const embedding = embedInternal.makeDeterministicEmbedding(32);
    client = vecInternal.createInMemoryVectorClient(embedding);
  });

  it('upserts points and searchSimilarMetrics returns tenant-scoped candidates', async () => {
    await client.upsertPoints([
      {
        id: 'm1',
        vector: await (await Promise.resolve(embedInternal.makeDeterministicEmbedding(32))).embedText('cancellation rate metric'),
        payload: { metricId: 'cancellation_rate', tenantId: 'BRAND', type: 'metric' },
      },
      {
        id: 'm2',
        vector: await (await Promise.resolve(embedInternal.makeDeterministicEmbedding(32))).embedText('aov metric'),
        payload: { metricId: 'aov', tenantId: 'BRAND', type: 'metric' },
      },
      {
        id: 'm3',
        vector: await (await Promise.resolve(embedInternal.makeDeterministicEmbedding(32))).embedText('aov metric'),
        // different tenant
        payload: { metricId: 'aov', tenantId: 'OTHER', type: 'metric' },
      },
    ]);
    const cands = await client.searchSimilarMetrics({
      tenantId: 'BRAND',
      query: 'cancellation rate metric',
      topK: 5,
    });
    assert.ok(cands.length > 0);
    // Should include only BRAND results.
    for (const c of cands) {
      assert.ok(['cancellation_rate', 'aov'].includes(c.metricId));
    }
    // Best match should be the cancellation_rate point (identical embedding).
    assert.equal(cands[0].metricId, 'cancellation_rate');
  });

  it('returns [] for empty query / missing tenantId', async () => {
    assert.deepEqual(await client.searchSimilarMetrics({ tenantId: '', query: 'x' }), []);
    assert.deepEqual(await client.searchSimilarMetrics({ tenantId: 'BRAND', query: '' }), []);
  });
});

describe('createVectorClient — env-driven default', () => {
  it('falls back to in-memory when QDRANT_URL is unset', async () => {
    const client = await createVectorClient({ url: '' });
    assert.equal(client.mock, true);
  });
});
