import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { createClient } from 'redis';
import { env } from '../apps/api/src/config/env.js';
import { createKafkaClient } from '../apps/api/src/modules/kafka/kafkaClient.js';
import { createChatMemoryArchive } from '../apps/api/src/modules/chatMemory/chatMemoryArchive.js';
import {
  parseChatMemoryChangedEvent,
} from '../apps/api/src/modules/chatMemory/chatMemoryKafkaProducer.js';
import { normalizeChatContext } from '../apps/api/src/modules/chatMemory/chatMemoryProvider.js';
import { logger } from '../apps/api/src/utils/logger.js';

/**
 * @typedef {import('../apps/api/src/modules/chatMemory/chatMemoryKafkaProducer.js').ChatMemoryChangedEvent} ChatMemoryChangedEvent
 *
 * @typedef {Object} KafkaOffsetRecord
 * @property {string} topic
 * @property {number} partition
 * @property {string} offset
 *
 * @typedef {Object} KafkaBatchItem
 * @property {ChatMemoryChangedEvent} event
 * @property {KafkaOffsetRecord} [offset]
 */

const conversationKeyFor = (event) =>
  `${event.brandId}:${event.userId}:${event.conversationId}`;

const nextKafkaOffset = (offset) => (BigInt(offset) + 1n).toString();

const coalesceOffsets = (records) => {
  /** @type {Map<string, KafkaOffsetRecord>} */
  const latest = new Map();
  for (const record of records) {
    const key = `${record.topic}:${record.partition}`;
    const existing = latest.get(key);
    if (!existing || BigInt(record.offset) > BigInt(existing.offset)) {
      latest.set(key, record);
    }
  }
  return Array.from(latest.values()).map((record) => ({
    topic: record.topic,
    partition: record.partition,
    offset: nextKafkaOffset(record.offset),
  }));
};

/**
 * @param {{
 *   redisClient: any,
 *   archive: import('../apps/api/src/modules/chatMemory/chatMemoryArchive.js').ChatMemoryArchive,
 *   items: KafkaBatchItem[],
 *   log?: Pick<typeof logger, 'info'|'warn'|'error'>,
 * }} args
 */
export const flushChatMemoryKafkaBatch = async ({
  redisClient,
  archive,
  items,
  log = logger,
}) => {
  const stats = {
    received: items.length,
    deduped: 0,
    persisted: 0,
    skipped: 0,
    parseFailures: 0,
    redisMisses: 0,
  };
  if (items.length === 0) return stats;

  /** @type {Map<string, ChatMemoryChangedEvent>} */
  const eventsByConversation = new Map();
  for (const item of items) {
    eventsByConversation.set(conversationKeyFor(item.event), item.event);
  }
  const events = Array.from(eventsByConversation.values());
  stats.deduped = events.length;

  if (!redisClient.isOpen && typeof redisClient.connect === 'function') {
    await redisClient.connect();
  }
  await archive.ensureIndexes();

  const docs = [];
  for (const event of events) {
    const raw = await redisClient.get(event.redisKey);
    if (!raw) {
      stats.redisMisses += 1;
      stats.skipped += 1;
      continue;
    }
    try {
      docs.push({
        brandId: event.brandId,
        userId: event.userId,
        conversationId: event.conversationId,
        redisKey: event.redisKey,
        memory: normalizeChatContext(JSON.parse(raw)),
      });
    } catch (err) {
      stats.parseFailures += 1;
      stats.skipped += 1;
      log.warn(
        { event: 'chatmemory.kafka_sync.parse_failed', redisKey: event.redisKey, err: String(err) },
        'skipping malformed Redis chat memory snapshot',
      );
    }
  }

  if (docs.length > 0) {
    if (typeof archive.upsertSnapshots === 'function') {
      stats.persisted = await archive.upsertSnapshots(docs);
    } else {
      for (const doc of docs) await archive.upsertSnapshot(doc);
      stats.persisted = docs.length;
    }
  }

  log.info(
    { event: 'chatmemory.kafka_sync.flushed', ...stats },
    'chat memory kafka batch flushed',
  );
  return stats;
};

/**
 * @param {{
 *   batchSize: number,
 *   flushMs: number,
 *   flush: (items: KafkaBatchItem[]) => Promise<void>,
 *   commit?: (offsets: Array<{ topic: string, partition: number, offset: string }>) => Promise<void>,
 *   setTimer?: Function,
 *   clearTimer?: Function,
 * }} cfg
 */
export const createChatMemoryKafkaBatcher = ({
  batchSize,
  flushMs,
  flush,
  commit = async () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) => {
  /** @type {Map<string, KafkaBatchItem>} */
  const pendingByConversation = new Map();
  /** @type {KafkaOffsetRecord[]} */
  const pendingOffsets = [];
  /** @type {any} */
  let timer = null;
  let flushing = Promise.resolve();

  const cancelTimer = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };

  const scheduleTimer = () => {
    if (timer || flushMs <= 0) return;
    timer = setTimer(() => {
      void flushNow().catch((err) => {
        logger.error(
          { event: 'chatmemory.kafka_sync.timer_flush_failed', err: String(err) },
          'chat memory kafka timer flush failed',
        );
      });
    }, flushMs);
  };

  const flushNow = async () => {
    flushing = flushing.then(async () => {
      cancelTimer();
      if (pendingByConversation.size === 0 && pendingOffsets.length === 0) return;
      const items = Array.from(pendingByConversation.values());
      const itemKeys = items.map((item) => conversationKeyFor(item.event));
      const offsetCount = pendingOffsets.length;
      const offsets = coalesceOffsets(pendingOffsets);
      await flush(items);
      if (offsets.length > 0) await commit(offsets);
      for (let i = 0; i < items.length; i += 1) {
        if (pendingByConversation.get(itemKeys[i]) === items[i]) {
          pendingByConversation.delete(itemKeys[i]);
        }
      }
      pendingOffsets.splice(0, offsetCount);
    });
    return flushing;
  };

  return {
    /**
     * @param {KafkaBatchItem} item
     */
    add: async (item) => {
      pendingByConversation.set(conversationKeyFor(item.event), item);
      if (item.offset) pendingOffsets.push(item.offset);
      if (pendingByConversation.size >= batchSize) {
        await flushNow();
      } else {
        scheduleTimer();
      }
    },
    flushNow,
    size: () => pendingByConversation.size,
  };
};

const messageValueToString = (value) => {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value);
};

export const runChatMemoryKafkaSyncWorker = async ({
  batchSize = env.chatMemoryKafka.batchSize,
  flushMs = env.chatMemoryKafka.flushMs,
} = {}) => {
  if (!env.redis.url) throw new Error('REDIS_URL is required for kafka chat memory sync');
  if (!env.mongo.uri) throw new Error('MONGO_URI is required for kafka chat memory sync');
  if (env.kafka.brokers.length === 0) throw new Error('KAFKA_BROKERS is required for kafka chat memory sync');

  const redisClient = createClient({ url: env.redis.url });
  redisClient.on('error', (err) => {
    logger.error({ event: 'chatmemory.kafka_sync.redis_error', err: String(err) }, 'redis sync client error');
  });

  const archive = await createChatMemoryArchive();
  if (!archive) throw new Error('Mongo chat memory archive is not configured');

  const kafka = await createKafkaClient();
  const consumer = kafka.consumer({ groupId: env.chatMemoryKafka.consumerGroup });
  await consumer.connect();
  await consumer.subscribe({ topic: env.chatMemoryKafka.topic, fromBeginning: false });

  const batcher = createChatMemoryKafkaBatcher({
    batchSize,
    flushMs,
    flush: async (items) => {
      await flushChatMemoryKafkaBatch({ redisClient, archive, items });
    },
    commit: async (offsets) => {
      await consumer.commitOffsets(offsets);
    },
  });

  const shutdown = async () => {
    try {
      await batcher.flushNow();
    } finally {
      await consumer.disconnect();
      if (redisClient.isOpen) await redisClient.quit();
    }
  };
  process.once('SIGINT', () => {
    shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    shutdown().finally(() => process.exit(0));
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = parseChatMemoryChangedEvent(messageValueToString(message.value));
        if (!event) {
          await consumer.commitOffsets([{ topic, partition, offset: nextKafkaOffset(message.offset) }]);
          return;
        }
        await batcher.add({
          event,
          offset: { topic, partition, offset: message.offset },
        });
      } catch (err) {
        logger.warn(
          { event: 'chatmemory.kafka_sync.message_failed', err: String(err) },
          'failed to process chat memory kafka message',
        );
      }
    },
  });
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runChatMemoryKafkaSyncWorker().catch((err) => {
    logger.error(
      { event: 'chatmemory.kafka_sync.fatal', err: String(err) },
      'chat memory kafka sync worker failed',
    );
    process.exit(1);
  });
}
