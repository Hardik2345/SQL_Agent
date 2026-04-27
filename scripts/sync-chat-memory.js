import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { createClient } from 'redis';
import { env } from '../apps/api/src/config/env.js';
import {
  createChatMemoryArchive,
  parseChatMemoryRedisKey,
} from '../apps/api/src/modules/chatMemory/chatMemoryArchive.js';
import { normalizeChatContext } from '../apps/api/src/modules/chatMemory/chatMemoryProvider.js';
import { logger } from '../apps/api/src/utils/logger.js';

const CHAT_MEMORY_SCAN_MATCH = 'sql-agent:chat:*';

/**
 * @typedef {Object} SyncStats
 * @property {number} scanned
 * @property {number} persisted
 * @property {number} skipped
 * @property {number} parseFailures
 * @property {number} mongoFailures
 */

const emptyStats = () => ({
  scanned: 0,
  persisted: 0,
  skipped: 0,
  parseFailures: 0,
  mongoFailures: 0,
});

const scanKeys = async (client, batchSize) => {
  if (typeof client.scanIterator === 'function') {
    /** @type {string[]} */
    const keys = [];
    for await (const key of client.scanIterator({
      MATCH: CHAT_MEMORY_SCAN_MATCH,
      COUNT: batchSize,
    })) {
      if (Array.isArray(key)) keys.push(...key);
      else keys.push(key);
    }
    return keys;
  }
  if (typeof client.keys === 'function') {
    return client.keys(CHAT_MEMORY_SCAN_MATCH);
  }
  throw new Error('redis client must expose scanIterator() or keys()');
};

/**
 * One Redis→Mongo sync pass. Purely dependency-injected so tests can use fake
 * Redis and fake Mongo sinks without starting external services.
 *
 * @param {{
 *   redisClient: any,
 *   archive: import('../apps/api/src/modules/chatMemory/chatMemoryArchive.js').ChatMemoryArchive,
 *   batchSize?: number,
 *   log?: Pick<typeof logger, 'info'|'warn'|'error'>,
 * }} args
 * @returns {Promise<SyncStats>}
 */
export const syncChatMemoryOnce = async ({
  redisClient,
  archive,
  batchSize = env.chatMemorySync.batchSize,
  log = logger,
}) => {
  const stats = emptyStats();

  if (!redisClient.isOpen && typeof redisClient.connect === 'function') {
    await redisClient.connect();
  }
  await archive.ensureIndexes();

  const keys = await scanKeys(redisClient, batchSize);
  for (const redisKey of keys) {
    stats.scanned += 1;
    const parsedKey = parseChatMemoryRedisKey(redisKey);
    if (!parsedKey) {
      stats.skipped += 1;
      log.warn({ event: 'chatmemory.sync.invalid_key', redisKey }, 'skipping invalid chat memory key');
      continue;
    }

    const raw = await redisClient.get(redisKey);
    if (!raw) {
      stats.skipped += 1;
      continue;
    }

    /** @type {any} */
    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      stats.parseFailures += 1;
      log.warn(
        { event: 'chatmemory.sync.parse_failed', redisKey, err: String(err) },
        'skipping malformed chat memory json',
      );
      continue;
    }

    try {
      await archive.upsertSnapshot({
        brandId: parsedKey.brandId,
        userId: parsedKey.userId,
        conversationId: parsedKey.conversationId,
        redisKey,
        memory: normalizeChatContext(json),
      });
      stats.persisted += 1;
    } catch (err) {
      stats.mongoFailures += 1;
      log.error(
        { event: 'chatmemory.sync.mongo_failed', redisKey, err: String(err) },
        'failed to persist chat memory snapshot',
      );
    }
  }

  log.info({ event: 'chatmemory.sync.completed', ...stats }, 'chat memory sync pass completed');
  return stats;
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export const runChatMemorySyncWorker = async ({
  once = false,
  intervalMs = env.chatMemorySync.intervalMs,
  batchSize = env.chatMemorySync.batchSize,
} = {}) => {
  if (!env.redis.url) throw new Error('REDIS_URL is required for chat memory sync');
  if (!env.mongo.uri) throw new Error('MONGO_URI is required for chat memory sync');

  const redisClient = createClient({ url: env.redis.url });
  redisClient.on('error', (err) => {
    logger.error({ event: 'chatmemory.sync.redis_error', err: String(err) }, 'redis sync client error');
  });

  const archive = await createChatMemoryArchive();
  if (!archive) throw new Error('Mongo chat memory archive is not configured');

  try {
    do {
      await syncChatMemoryOnce({ redisClient, archive, batchSize });
      if (once) break;
      await sleep(intervalMs);
    } while (true);
  } finally {
    if (redisClient.isOpen) await redisClient.quit();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runChatMemorySyncWorker({ once: process.argv.includes('--once') }).catch((err) => {
    logger.error({ event: 'chatmemory.sync.fatal', err: String(err) }, 'chat memory sync worker failed');
    process.exit(1);
  });
}

