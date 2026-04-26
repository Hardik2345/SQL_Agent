import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { assertSemanticMetric } from './semantic.types.js';

/**
 * @typedef {import('./semantic.types.js').SemanticMetric} SemanticMetric
 * @typedef {import('./semantic.types.js').SemanticCatalog} SemanticCatalog
 */

/**
 * Build a SemanticCatalog over a JS Map. Used as the default
 * implementation when `MONGO_URI` is unset and as the test seed for
 * everything in the semantic / context layer.
 *
 * Tenant scoping is enforced by the API surface (`getMetricsByIds`
 * takes a `tenantId` argument and filters by it). The underlying Map
 * is keyed by `tenantId:metricId` so cross-tenant lookups can never
 * accidentally collide.
 *
 * @param {Iterable<SemanticMetric>} [seed]
 * @returns {SemanticCatalog & { upsert: (m: SemanticMetric) => void, clear: () => void, size: () => number }}
 */
export const createInMemorySemanticCatalog = (seed = []) => {
  /** @type {Map<string, SemanticMetric>} */
  const store = new Map();
  const keyFor = (tenantId, metricId) => `${tenantId}:${metricId}`;

  const upsert = (metric) => {
    const valid = assertSemanticMetric(metric);
    store.set(keyFor(valid.tenantId, valid.metricId), valid);
  };
  for (const m of seed) upsert(m);

  return {
    upsert,
    clear: () => store.clear(),
    size: () => store.size,
    /**
     * @param {string[]} metricIds
     * @param {string} tenantId
     */
    getMetricsByIds: async (metricIds, tenantId) => {
      if (!Array.isArray(metricIds) || metricIds.length === 0) return [];
      /** @type {SemanticMetric[]} */
      const out = [];
      for (const id of metricIds) {
        const hit = store.get(keyFor(tenantId, id));
        if (hit) out.push(hit);
      }
      return out;
    },
    /**
     * @param {string} term
     * @param {string} tenantId
     */
    getMetricsBySynonym: async (term, tenantId) => {
      if (!term) return [];
      const lower = term.toLowerCase();
      /** @type {SemanticMetric[]} */
      const out = [];
      for (const m of store.values()) {
        if (m.tenantId !== tenantId) continue;
        if (m.metricId.toLowerCase() === lower) {
          out.push(m);
          continue;
        }
        if (Array.isArray(m.synonyms) && m.synonyms.some((s) => typeof s === 'string' && s.toLowerCase() === lower)) {
          out.push(m);
        }
      }
      return out;
    },
  };
};

/**
 * MongoDB-backed semantic catalog. Lazy-imports the `mongodb` driver
 * so the dep is only loaded when an URI is configured. If the package
 * isn't installed in the runtime, we log a warning and return the
 * in-memory fallback rather than crashing the boot.
 *
 * @param {{ uri: string, db: string, collection: string }} cfg
 * @returns {Promise<SemanticCatalog>}
 */
const createMongoSemanticCatalog = async (cfg) => {
  /** @type {any} */
  let mongoMod;
  try {
    // Variable-specifier dynamic import so TypeScript skips
    // resolution. `mongodb` is optional — only required when
    // MONGO_URI is set.
    const specifier = 'mongodb';
    mongoMod = await import(specifier);
  } catch (err) {
    logger.error(
      { event: 'semantic.mongo.import_failed', err: String(err) },
      'mongodb package not installed; falling back to in-memory semantic catalog',
    );
    return createInMemorySemanticCatalog();
  }

  const client = new mongoMod.MongoClient(cfg.uri);
  /** @type {any} */
  let collection;

  const ensureConnected = async () => {
    if (!collection) {
      await client.connect();
      collection = client.db(cfg.db).collection(cfg.collection);
      logger.info(
        { event: 'semantic.mongo.connected', db: cfg.db, collection: cfg.collection },
        'mongodb semantic catalog connected',
      );
    }
    return collection;
  };

  return {
    /**
     * @param {string[]} metricIds
     * @param {string} tenantId
     */
    getMetricsByIds: async (metricIds, tenantId) => {
      if (!Array.isArray(metricIds) || metricIds.length === 0) return [];
      const c = await ensureConnected();
      const docs = await c.find({ tenantId, metricId: { $in: metricIds } }).toArray();
      return docs.map((d) => assertSemanticMetric({
        metricId: d.metricId,
        tenantId: d.tenantId,
        formula: d.formula,
        description: d.description,
        synonyms: d.synonyms,
        tables: d.tables,
        columns: d.columns,
        version: d.version,
      }));
    },
    /**
     * @param {string} term
     * @param {string} tenantId
     */
    getMetricsBySynonym: async (term, tenantId) => {
      if (!term) return [];
      const c = await ensureConnected();
      const docs = await c
        .find({
          tenantId,
          $or: [
            { metricId: term },
            { synonyms: term },
          ],
        })
        .toArray();
      return docs.map((d) => assertSemanticMetric({
        metricId: d.metricId,
        tenantId: d.tenantId,
        formula: d.formula,
        description: d.description,
        synonyms: d.synonyms,
        tables: d.tables,
        columns: d.columns,
        version: d.version,
      }));
    },
  };
};

/**
 * Factory the rest of the codebase calls. Falls back to an empty
 * in-memory catalog when `MONGO_URI` is unset — so tests and CI runs
 * without Mongo work, just with no metric definitions resolved.
 *
 * @param {{ uri?: string, db?: string, collection?: string, seed?: SemanticMetric[] }} [options]
 * @returns {Promise<SemanticCatalog>}
 */
export const createSemanticProvider = async (options = {}) => {
  const uri = options.uri ?? env.mongo.uri;
  if (!uri) {
    logger.debug(
      { event: 'semantic.fallback', reason: 'no MONGO_URI' },
      'using in-memory semantic catalog',
    );
    return createInMemorySemanticCatalog(options.seed ?? []);
  }
  return createMongoSemanticCatalog({
    uri,
    db: options.db ?? env.mongo.db,
    collection: options.collection ?? env.mongo.metricsCollection,
  });
};

/**
 * Map a list of `SemanticMetric` records into the `globalContext.metrics`
 * shape the planner consumes. Pure / synchronous so tests can call it
 * directly.
 *
 * @param {SemanticMetric[]} metrics
 * @returns {Record<string, { formula?: string, description?: string, synonyms?: string[] }>}
 */
export const metricsToGlobalContext = (metrics) => {
  /** @type {Record<string, { formula?: string, description?: string, synonyms?: string[] }>} */
  const out = {};
  for (const m of metrics) {
    out[m.metricId] = {
      formula: m.formula,
      description: m.description,
      synonyms: Array.isArray(m.synonyms) ? m.synonyms.slice() : undefined,
    };
  }
  return out;
};
