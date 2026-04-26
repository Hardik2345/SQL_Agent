import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {(text: string) => Promise<number[]>} EmbedFn
 *
 * @typedef {Object} EmbeddingService
 * @property {EmbedFn} embedText
 * @property {string}  model       Logical model name (used for trace logs).
 * @property {number}  dimensions
 * @property {boolean} mock        True iff we're using the deterministic hash fallback.
 */

/**
 * Deterministic, dependency-free embedding stub used when the OpenAI
 * key is missing. Hashes the text with SHA-256 repeatedly to fill a
 * fixed-dimension float vector, normalised to unit length. Identical
 * input always yields identical output, which is exactly what we
 * want for unit tests.
 *
 * Real embeddings produce semantically meaningful similarity. The
 * mock does NOT — it produces a stable but content-agnostic vector
 * that two different inputs almost always disagree on. That's OK:
 * the mock vector store also runs in-memory and is responsible for
 * its own deterministic ordering.
 *
 * @param {number} dimensions
 * @returns {EmbeddingService}
 */
const makeDeterministicEmbedding = (dimensions) => {
  const embedText = async (text) => {
    const input = String(text ?? '');
    /** @type {number[]} */
    const out = new Array(dimensions);
    let cursor = 0;
    let nonce = 0;
    while (cursor < dimensions) {
      const digest = createHash('sha256')
        .update(`${nonce}:${input}`)
        .digest();
      for (let i = 0; i < digest.length && cursor < dimensions; i += 4) {
        // Map 4 bytes → [-1, 1) in a stable way.
        const v = digest.readUInt32BE(i) / 0xffffffff;
        out[cursor++] = v * 2 - 1;
      }
      nonce++;
    }
    // L2-normalise so cosine similarity is the same as dot product.
    let norm = 0;
    for (const v of out) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  };
  return { embedText, model: 'mock-sha256', dimensions, mock: true };
};

/**
 * Build an embedding service backed by OpenAI. Lazy-imports
 * `@langchain/openai` so the dep is only loaded when an API key is
 * configured.
 *
 * @param {{ apiKey: string, model: string, dimensions: number }} cfg
 * @returns {Promise<EmbeddingService>}
 */
const makeOpenAIEmbedding = async (cfg) => {
  /** @type {any} */
  let mod;
  try {
    mod = await import('@langchain/openai');
  } catch (err) {
    logger.warn(
      { event: 'embedding.openai.import_failed', err: String(err) },
      '@langchain/openai not loadable; falling back to deterministic mock',
    );
    return makeDeterministicEmbedding(cfg.dimensions);
  }

  const client = new mod.OpenAIEmbeddings({
    apiKey: cfg.apiKey,
    model: cfg.model,
  });

  return {
    model: cfg.model,
    dimensions: cfg.dimensions,
    mock: false,
    embedText: async (text) => {
      const input = String(text ?? '');
      const v = await client.embedQuery(input);
      if (!Array.isArray(v) || v.length === 0) {
        throw new Error('OpenAIEmbeddings.embedQuery returned empty vector');
      }
      return v;
    },
  };
};

/**
 * Default factory. Picks OpenAI when a key is set, falls back to the
 * deterministic mock otherwise. Tests inject a custom service via the
 * vectorClient factory rather than calling this.
 *
 * @param {{ apiKey?: string, model?: string, dimensions?: number }} [options]
 * @returns {Promise<EmbeddingService>}
 */
export const createEmbeddingService = async (options = {}) => {
  const apiKey = options.apiKey ?? env.llm.apiKey;
  const model = options.model ?? env.embedding.model;
  const dimensions = options.dimensions ?? env.embedding.dimensions;
  if (!apiKey) {
    logger.debug(
      { event: 'embedding.fallback', reason: 'no OPENAI_API_KEY' },
      'using deterministic embedding fallback',
    );
    return makeDeterministicEmbedding(dimensions);
  }
  return makeOpenAIEmbedding({ apiKey, model, dimensions });
};

export const _internal = { makeDeterministicEmbedding };
