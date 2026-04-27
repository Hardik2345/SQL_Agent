import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {import('../contracts/agentState.js').ChatContext} ChatContext
 *
 * @typedef {Object} MemoryKey
 * @property {string} brandId
 * @property {string} userId
 * @property {string} conversationId
 *
 * @typedef {Object} ChatMemoryArchive
 * @property {() => Promise<void>} ensureIndexes
 * @property {(key: MemoryKey) => Promise<ChatContext|null>} getSnapshot
 * @property {(args: MemoryKey & { memory: Partial<ChatContext>, redisKey?: string }) => Promise<void>} upsertSnapshot
 * @property {(items: Array<MemoryKey & { memory: Partial<ChatContext>, redisKey?: string }>) => Promise<number>} upsertSnapshots
 * @property {() => Promise<void>} clear
 */

export const CHAT_MEMORY_REDIS_PREFIX = 'sql-agent:chat:';

/**
 * @param {MemoryKey} key
 * @returns {string}
 */
export const chatMemoryRedisKeyFor = ({ brandId, userId, conversationId }) =>
  `${CHAT_MEMORY_REDIS_PREFIX}${brandId}:${userId}:${conversationId}`;

/**
 * Local normalizer copy to keep this archive module dependency-light and avoid
 * a provider/archive import cycle.
 *
 * @param {Partial<ChatContext>|null|undefined} value
 * @returns {ChatContext}
 */
const normalizeArchivedChatContext = (value) => {
  const v = value && typeof value === 'object' ? value : {};
  return {
    previousQuestions: Array.isArray(v.previousQuestions) ? v.previousQuestions.slice() : [],
    confirmedMetricDefinitions:
      v.confirmedMetricDefinitions && typeof v.confirmedMetricDefinitions === 'object'
        ? { ...v.confirmedMetricDefinitions }
        : {},
    lastUsedFilters: Array.isArray(v.lastUsedFilters) ? v.lastUsedFilters.slice() : [],
    lastResultSummary:
      typeof v.lastResultSummary === 'string' ? v.lastResultSummary : null,
    lastMetricRefs: Array.isArray(v.lastMetricRefs) ? v.lastMetricRefs.slice() : [],
    lastFilterRefs: Array.isArray(v.lastFilterRefs) ? v.lastFilterRefs.slice() : [],
  };
};

/**
 * @param {string} redisKey
 * @returns {(MemoryKey & { redisKey: string })|null}
 */
export const parseChatMemoryRedisKey = (redisKey) => {
  if (typeof redisKey !== 'string' || !redisKey.startsWith(CHAT_MEMORY_REDIS_PREFIX)) {
    return null;
  }
  const rest = redisKey.slice(CHAT_MEMORY_REDIS_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length < 3) return null;
  const [brandId, userId, ...conversationParts] = parts;
  const conversationId = conversationParts.join(':');
  if (!brandId || !userId || !conversationId) return null;
  return { brandId, userId, conversationId, redisKey };
};

/**
 * @param {{ redisKey?: string, memory: Partial<ChatContext>, ttlSeconds: number, now?: Date }} args
 * @returns {{ memory: ChatContext, redisKey?: string, updatedAt: Date, expiresAt: Date }}
 */
export const buildChatMemoryArchiveDocument = ({
  redisKey,
  memory,
  ttlSeconds,
  now = new Date(),
}) => {
  const retentionMs = Math.max(0, ttlSeconds) * 1000;
  return {
    memory: normalizeArchivedChatContext(memory),
    redisKey,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + retentionMs),
  };
};

/**
 * Mongo-backed durable chat memory archive. It is deliberately a snapshot
 * store: request-time writes stay Redis-only, and the sync worker periodically
 * upserts the latest Redis value here.
 *
 * @param {{ uri: string, db: string, collection: string, ttlSeconds: number }} cfg
 * @returns {Promise<ChatMemoryArchive|null>}
 */
export const createMongoChatMemoryArchive = async (cfg) => {
  if (!cfg.uri) return null;

  /** @type {any} */
  let mongoMod;
  try {
    const specifier = 'mongodb';
    mongoMod = await import(specifier);
  } catch (err) {
    logger.error(
      { event: 'chatmemory.mongo.import_failed', err: String(err) },
      'mongodb package not installed; disabling chat memory archive',
    );
    return null;
  }

  const client = new mongoMod.MongoClient(cfg.uri);
  /** @type {any} */
  let collection;
  let indexesEnsured = false;

  const ensureConnected = async () => {
    if (!collection) {
      await client.connect();
      collection = client.db(cfg.db).collection(cfg.collection);
      logger.info(
        { event: 'chatmemory.mongo.connected', db: cfg.db, collection: cfg.collection },
        'mongodb chat memory archive connected',
      );
    }
    return collection;
  };

  const ensureIndexes = async () => {
    if (indexesEnsured) return;
    const c = await ensureConnected();
    await c.createIndex(
      { brandId: 1, userId: 1, conversationId: 1 },
      { unique: true, name: 'chat_memory_identity_unique' },
    );
    await c.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'chat_memory_expires_at_ttl' },
    );
    await c.createIndex(
      { brandId: 1, userId: 1 },
      { name: 'chat_memory_tenant_user_lookup' },
    );
    indexesEnsured = true;
  };

  return {
    ensureIndexes,
    getSnapshot: async ({ brandId, userId, conversationId }) => {
      await ensureIndexes();
      const c = await ensureConnected();
      const doc = await c.findOne({ brandId, userId, conversationId });
      if (!doc) return null;
      if (doc.expiresAt instanceof Date && doc.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      return normalizeArchivedChatContext(doc.memory);
    },
    upsertSnapshot: async ({ brandId, userId, conversationId, memory, redisKey }) => {
      await ensureIndexes();
      const c = await ensureConnected();
      const doc = buildChatMemoryArchiveDocument({
        redisKey,
        memory,
        ttlSeconds: cfg.ttlSeconds,
      });
      await c.updateOne(
        { brandId, userId, conversationId },
        {
          $set: {
            brandId,
            userId,
            conversationId,
            ...doc,
          },
        },
        { upsert: true },
      );
    },
    upsertSnapshots: async (items) => {
      if (!Array.isArray(items) || items.length === 0) return 0;
      await ensureIndexes();
      const c = await ensureConnected();
      const operations = items.map((item) => {
        const doc = buildChatMemoryArchiveDocument({
          redisKey: item.redisKey,
          memory: item.memory,
          ttlSeconds: cfg.ttlSeconds,
        });
        return {
          updateOne: {
            filter: {
              brandId: item.brandId,
              userId: item.userId,
              conversationId: item.conversationId,
            },
            update: {
              $set: {
                brandId: item.brandId,
                userId: item.userId,
                conversationId: item.conversationId,
                ...doc,
              },
            },
            upsert: true,
          },
        };
      });
      await c.bulkWrite(operations, { ordered: false });
      return operations.length;
    },
    clear: async () => {
      const c = await ensureConnected();
      await c.deleteMany({});
    },
  };
};

/**
 * @param {{ uri?: string, db?: string, collection?: string, ttlSeconds?: number }} [options]
 * @returns {Promise<ChatMemoryArchive|null>}
 */
export const createChatMemoryArchive = async (options = {}) =>
  createMongoChatMemoryArchive({
    uri: options.uri ?? env.mongo.uri,
    db: options.db ?? env.mongo.db,
    collection: options.collection ?? env.mongo.chatMemoryCollection,
    ttlSeconds: options.ttlSeconds ?? env.mongo.chatMemoryTtlSeconds,
  });
