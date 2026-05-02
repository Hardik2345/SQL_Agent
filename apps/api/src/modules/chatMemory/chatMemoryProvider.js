import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  chatMemoryRedisKeyFor,
  createChatMemoryArchive,
} from './chatMemoryArchive.js';
import { createChatMemoryKafkaProducer } from './chatMemoryKafkaProducer.js';

/**
 * @typedef {import('../contracts/agentState.js').ChatContext} ChatContext
 *
 * @typedef {Object} MemoryKey
 * @property {string} brandId
 * @property {string} userId
 * @property {string} conversationId
 *
 * @typedef {Object} ChatMemoryProvider
 * @property {(key: MemoryKey) => Promise<ChatContext>}                    getChatContext
 * @property {(args: MemoryKey & { memoryDelta: Partial<ChatContext> }) => Promise<ChatContext>} updateChatContext
 * @property {(key: MemoryKey) => Promise<void>}                            deleteChatContext
 * @property {() => Promise<void>}                                          clear
 * @property {boolean}                                                      mock
 */

/**
 * Always-non-null normalized ChatContext. Anywhere we read or merge
 * chat memory we round-trip through this so callers never have to
 * null-check fields.
 *
 * @param {Partial<ChatContext>|null|undefined} value
 * @returns {ChatContext}
 */
export const normalizeChatContext = (value) => {
  const v = value && typeof value === 'object' ? value : {};
  const pc = v.pendingClarification;
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
    pendingClarification:
      pc && typeof pc.originalQuestion === 'string' && typeof pc.clarificationQuestion === 'string'
        ? { originalQuestion: pc.originalQuestion, clarificationQuestion: pc.clarificationQuestion }
        : null,
  };
};

/**
 * Merge a delta into an existing context. Lists append (capped to a
 * recent window for `previousQuestions`); maps merge with
 * delta-precedence; scalars overwrite when defined in delta.
 *
 * @param {ChatContext} existing
 * @param {Partial<ChatContext>} delta
 * @returns {ChatContext}
 */
export const mergeChatContext = (existing, delta) => {
  const next = normalizeChatContext(existing);
  if (!delta || typeof delta !== 'object') return next;

  if (Array.isArray(delta.previousQuestions)) {
    const merged = next.previousQuestions.concat(delta.previousQuestions);
    next.previousQuestions = merged.slice(-10);
  }
  if (delta.confirmedMetricDefinitions && typeof delta.confirmedMetricDefinitions === 'object') {
    next.confirmedMetricDefinitions = {
      ...next.confirmedMetricDefinitions,
      ...delta.confirmedMetricDefinitions,
    };
  }
  if (Array.isArray(delta.lastUsedFilters)) next.lastUsedFilters = delta.lastUsedFilters.slice();
  if (Array.isArray(delta.lastFilterRefs)) next.lastFilterRefs = delta.lastFilterRefs.slice();
  if (Array.isArray(delta.lastMetricRefs)) next.lastMetricRefs = delta.lastMetricRefs.slice();
  if (delta.lastResultSummary !== undefined) {
    next.lastResultSummary = typeof delta.lastResultSummary === 'string'
      ? delta.lastResultSummary
      : null;
  }
  // pendingClarification: explicit null clears it (used after a follow-up resolves it);
  // a defined object sets it; undefined leaves the existing value.
  if ('pendingClarification' in delta) {
    const pc = delta.pendingClarification;
    next.pendingClarification =
      pc && typeof pc.originalQuestion === 'string' && typeof pc.clarificationQuestion === 'string'
        ? { originalQuestion: pc.originalQuestion, clarificationQuestion: pc.clarificationQuestion }
        : null;
  }
  return next;
};

const keyFor = chatMemoryRedisKeyFor;

/**
 * In-memory chat-memory provider. Honours the configured TTL by
 * stamping each entry with an expiry timestamp; reads past expiry
 * yield a fresh empty context. Used as the default when
 * `REDIS_URL` is unset.
 *
 * @param {{ ttlSeconds: number, now?: () => number }} cfg
 * @returns {ChatMemoryProvider}
 */
const createInMemoryChatMemoryProvider = (cfg) => {
  const now = cfg.now ?? (() => Date.now());
  /** @type {Map<string, { value: ChatContext, expiresAt: number }>} */
  const store = new Map();

  return {
    mock: true,
    clear: async () => store.clear(),
    getChatContext: async (key) => {
      const k = keyFor(key);
      const hit = store.get(k);
      if (!hit) return normalizeChatContext({});
      if (hit.expiresAt > 0 && hit.expiresAt < now()) {
        store.delete(k);
        return normalizeChatContext({});
      }
      return normalizeChatContext(hit.value);
    },
    updateChatContext: async ({ memoryDelta, ...key }) => {
      const k = keyFor(key);
      const existing = store.get(k);
      const base = existing && existing.expiresAt >= now()
        ? existing.value
        : normalizeChatContext({});
      const next = mergeChatContext(base, memoryDelta);
      const expiresAt = cfg.ttlSeconds > 0 ? now() + cfg.ttlSeconds * 1000 : 0;
      store.set(k, { value: next, expiresAt });
      return next;
    },
    deleteChatContext: async (key) => {
      store.delete(keyFor(key));
    },
  };
};

/**
 * Redis-backed chat-memory provider. Lazy-imports the `redis`
 * package; if it's not installed we log + return the in-memory
 * fallback so the system still runs.
 *
 * @param {{
 *   url: string,
 *   ttlSeconds: number,
 *   archive?: import('./chatMemoryArchive.js').ChatMemoryArchive|null,
 *   kafkaProducer?: ReturnType<typeof createChatMemoryKafkaProducer>|null,
 *   client?: any,
 * }} cfg
 * @returns {Promise<ChatMemoryProvider>}
 */
export const createRedisChatMemoryProvider = async (cfg) => {
  /** @type {any} */
  let mod;
  if (!cfg.client) {
    try {
      // Variable-specifier dynamic import so TypeScript skips
      // module-resolution at type-check time. The `redis` package is
      // optional — only required when REDIS_URL is set.
      const specifier = 'redis';
      mod = await import(specifier);
    } catch (err) {
      logger.error(
        { event: 'chatmemory.redis.import_failed', err: String(err) },
        'redis package not installed; falling back to in-memory chat memory',
      );
      return createInMemoryChatMemoryProvider({ ttlSeconds: cfg.ttlSeconds });
    }
  }

  const client = cfg.client ?? mod.createClient({ url: cfg.url });
  if (typeof client.on === 'function') {
    client.on('error', (err) => {
      logger.error({ event: 'chatmemory.redis.error', err: String(err) }, 'redis error');
    });
  }

  const ensureConnected = async () => {
    if (!client.isOpen && typeof client.connect === 'function') await client.connect();
  };

  const writeRedis = async (redisKey, memory) => {
    const payload = JSON.stringify(memory);
    if (cfg.ttlSeconds > 0) {
      await client.set(redisKey, payload, { EX: cfg.ttlSeconds });
    } else {
      await client.set(redisKey, payload);
    }
  };

  return {
    mock: false,
    clear: async () => {
      await ensureConnected();
      const keys = await client.keys('sql-agent:chat:*');
      if (keys.length > 0) await client.del(keys);
    },
    getChatContext: async (key) => {
      await ensureConnected();
      const redisKey = keyFor(key);
      const raw = await client.get(redisKey);
      if (!raw) {
        if (!cfg.archive) return normalizeChatContext({});
        try {
          const archived = await cfg.archive.getSnapshot(key);
          if (!archived) return normalizeChatContext({});
          await writeRedis(redisKey, archived);
          logger.debug(
            {
              event: 'chatmemory.mongo.fallback_hit',
              brandId: key.brandId,
              userId: key.userId,
              conversationId: key.conversationId,
            },
            'chat memory restored from mongo archive',
          );
          return normalizeChatContext(archived);
        } catch (err) {
          logger.warn(
            {
              event: 'chatmemory.mongo.fallback_failed',
              err: String(err),
              brandId: key.brandId,
              userId: key.userId,
              conversationId: key.conversationId,
            },
            'chat memory archive lookup failed; returning empty',
          );
          return normalizeChatContext({});
        }
      }
      try {
        return normalizeChatContext(JSON.parse(raw));
      } catch (err) {
        logger.warn(
          { event: 'chatmemory.redis.parse_failed', err: String(err) },
          'failed to parse chat memory; returning empty',
        );
        return normalizeChatContext({});
      }
    },
    updateChatContext: async ({ memoryDelta, ...key }) => {
      await ensureConnected();
      const k = keyFor(key);
      const raw = await client.get(k);
      let base = {};
      if (raw) {
        try {
          base = JSON.parse(raw);
        } catch (err) {
          logger.warn(
            { event: 'chatmemory.redis.parse_failed', err: String(err) },
            'failed to parse chat memory before update; overwriting from empty',
          );
        }
      }
      const next = mergeChatContext(base, memoryDelta);
      await writeRedis(k, next);
      if (cfg.kafkaProducer) {
        await cfg.kafkaProducer.publishChanged(key);
      }
      return next;
    },
    deleteChatContext: async (key) => {
      await ensureConnected();
      const redisKey = keyFor(key);
      await client.del(redisKey);
      if (cfg.archive?.deleteSnapshot) {
        await cfg.archive.deleteSnapshot(key);
      }
      if (cfg.kafkaProducer) {
        await cfg.kafkaProducer.publishChanged(key);
      }
    },
  };
};

/**
 * Factory the rest of the codebase calls. Falls back to in-memory
 * when `REDIS_URL` is unset.
 *
 * @param {{ url?: string, ttlSeconds?: number }} [options]
 * @returns {Promise<ChatMemoryProvider>}
 */
export const createChatMemoryProvider = async (options = {}) => {
  const url = options.url ?? env.redis.url;
  const ttlSeconds = options.ttlSeconds ?? env.redis.chatTtlSeconds;
  if (!url) {
    logger.debug(
      { event: 'chatmemory.fallback', reason: 'no REDIS_URL' },
      'using in-memory chat memory',
    );
    return createInMemoryChatMemoryProvider({ ttlSeconds });
  }
  const archive = await createChatMemoryArchive();
  const kafkaProducer = createChatMemoryKafkaProducer();
  return createRedisChatMemoryProvider({
    url,
    ttlSeconds,
    archive,
    kafkaProducer,
  });
};

export const _internal = {
  createInMemoryChatMemoryProvider,
  createRedisChatMemoryProvider,
  keyFor,
};
