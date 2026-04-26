import { request as undiciRequest } from 'undici';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { createEmbeddingService } from './embeddingService.js';

/**
 * @typedef {Object} VectorCandidate
 * @property {string} metricId
 * @property {number} score
 *
 * @typedef {Object} VectorPoint
 * @property {string|number}                              id
 * @property {number[]}                                   vector
 * @property {{ metricId: string, tenantId: string, type?: string }} payload
 *
 * @typedef {Object} VectorClient
 * @property {(args: { tenantId: string, query: string, topK?: number }) => Promise<VectorCandidate[]>} searchSimilarMetrics
 * @property {(points: VectorPoint[]) => Promise<void>} upsertPoints
 * @property {() => Promise<void>}                       clear
 * @property {boolean}                                    mock
 */

/**
 * In-memory vector "store" used as the default when `QDRANT_URL` is
 * unset. Keeps the points keyed by (tenantId, id) and computes cosine
 * similarity across the matching tenant's points. Sufficient for
 * tests; production should set `QDRANT_URL`.
 *
 * @param {import('./embeddingService.js').EmbeddingService} embedding
 * @returns {VectorClient}
 */
const createInMemoryVectorClient = (embedding) => {
  /** @type {Map<string, VectorPoint>} */
  const store = new Map();
  const keyFor = (tenantId, id) => `${tenantId}:${id}`;

  const cosine = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
    return dot / denom;
  };

  return {
    mock: true,
    upsertPoints: async (points) => {
      for (const p of points) {
        if (!p?.payload?.tenantId) continue;
        store.set(keyFor(p.payload.tenantId, p.id), p);
      }
    },
    clear: async () => store.clear(),
    searchSimilarMetrics: async ({ tenantId, query, topK = 5 }) => {
      if (!tenantId || !query) return [];
      const queryVec = await embedding.embedText(query);
      /** @type {VectorCandidate[]} */
      const ranked = [];
      for (const p of store.values()) {
        if (p.payload.tenantId !== tenantId) continue;
        if (!p.payload.metricId) continue;
        ranked.push({
          metricId: p.payload.metricId,
          score: cosine(queryVec, p.vector),
        });
      }
      ranked.sort((a, b) => b.score - a.score);
      return ranked.slice(0, topK);
    },
  };
};

/**
 * Qdrant REST client over `undici`. Avoids pulling in
 * `@qdrant/js-client-rest` so the dep set stays small. Implements the
 * narrow surface this module needs: upsert + search.
 *
 * @param {{
 *   url: string,
 *   apiKey?: string,
 *   collection: string,
 *   embedding: import('./embeddingService.js').EmbeddingService,
 *   fetchImpl?: typeof undiciRequest,
 * }} cfg
 * @returns {VectorClient}
 */
const createQdrantVectorClient = (cfg) => {
  const fetchImpl = cfg.fetchImpl ?? undiciRequest;
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers['api-key'] = cfg.apiKey;
  const collectionUrl = (path) =>
    new URL(`/collections/${cfg.collection}${path}`, cfg.url).toString();

  const callJson = async (url, body) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`qdrant ${url} → ${res.statusCode}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  return {
    mock: false,
    upsertPoints: async (points) => {
      if (!points.length) return;
      await callJson(collectionUrl('/points?wait=true'), {
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
    },
    clear: async () => {
      await callJson(collectionUrl('/points/delete?wait=true'), {
        filter: {},
      });
    },
    searchSimilarMetrics: async ({ tenantId, query, topK = 5 }) => {
      if (!tenantId || !query) return [];
      const vector = await cfg.embedding.embedText(query);
      const result = await callJson(collectionUrl('/points/search'), {
        vector,
        limit: topK,
        with_payload: true,
        filter: {
          must: [{ key: 'tenantId', match: { value: tenantId } }],
        },
      });
      const hits = Array.isArray(result?.result) ? result.result : [];
      return hits
        .map((h) => ({
          metricId: h?.payload?.metricId,
          score: typeof h?.score === 'number' ? h.score : 0,
        }))
        .filter((c) => typeof c.metricId === 'string' && c.metricId.length > 0);
    },
  };
};

/**
 * Default factory. When `QDRANT_URL` is unset OR the embedding
 * service can't be initialised, falls back to the in-memory store.
 * Tests can inject either an explicit `embedding` or both.
 *
 * @param {{
 *   url?: string,
 *   apiKey?: string,
 *   collection?: string,
 *   embedding?: import('./embeddingService.js').EmbeddingService,
 *   fetchImpl?: typeof undiciRequest,
 * }} [options]
 * @returns {Promise<VectorClient>}
 */
export const createVectorClient = async (options = {}) => {
  const url = options.url ?? env.qdrant.url;
  const collection = options.collection ?? env.qdrant.collection;
  const apiKey = options.apiKey ?? env.qdrant.apiKey;
  const embedding = options.embedding ?? (await createEmbeddingService());

  if (!url) {
    logger.debug(
      { event: 'vector.fallback', reason: 'no QDRANT_URL' },
      'using in-memory vector store',
    );
    return createInMemoryVectorClient(embedding);
  }

  return createQdrantVectorClient({
    url,
    apiKey,
    collection,
    embedding,
    fetchImpl: options.fetchImpl,
  });
};

export const _internal = { createInMemoryVectorClient, createQdrantVectorClient };
