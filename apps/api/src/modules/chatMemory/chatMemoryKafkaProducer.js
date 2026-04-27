import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { chatMemoryRedisKeyFor } from './chatMemoryArchive.js';
import { createKafkaClient } from '../kafka/kafkaClient.js';

/**
 * @typedef {Object} ChatMemoryChangedEvent
 * @property {'chat_memory_changed'} type
 * @property {1} version
 * @property {string} brandId
 * @property {string} userId
 * @property {string} conversationId
 * @property {string} redisKey
 * @property {string} updatedAt
 */

/**
 * @param {{ brandId: string, userId: string, conversationId: string, now?: Date }} args
 * @returns {{ key: string, event: ChatMemoryChangedEvent }}
 */
export const buildChatMemoryChangedEvent = ({
  brandId,
  userId,
  conversationId,
  now = new Date(),
}) => {
  const redisKey = chatMemoryRedisKeyFor({ brandId, userId, conversationId });
  return {
    key: `${brandId}:${userId}:${conversationId}`,
    event: {
      type: 'chat_memory_changed',
      version: 1,
      brandId,
      userId,
      conversationId,
      redisKey,
      updatedAt: now.toISOString(),
    },
  };
};

/**
 * @param {unknown} value
 * @returns {ChatMemoryChangedEvent|null}
 */
export const parseChatMemoryChangedEvent = (value) => {
  const event = typeof value === 'string' ? JSON.parse(value) : value;
  if (!event || typeof event !== 'object') return null;
  if (event.type !== 'chat_memory_changed' || event.version !== 1) return null;
  if (
    typeof event.brandId !== 'string' ||
    typeof event.userId !== 'string' ||
    typeof event.conversationId !== 'string' ||
    typeof event.redisKey !== 'string'
  ) {
    return null;
  }
  return {
    type: 'chat_memory_changed',
    version: 1,
    brandId: event.brandId,
    userId: event.userId,
    conversationId: event.conversationId,
    redisKey: event.redisKey,
    updatedAt: typeof event.updatedAt === 'string' ? event.updatedAt : new Date().toISOString(),
  };
};

/**
 * @param {{
 *   enabled?: boolean,
 *   topic?: string,
 *   brokers?: string[],
 *   kafka?: any,
 *   producer?: any,
 *   log?: Pick<typeof logger, 'debug'|'warn'|'error'>,
 * }} [cfg]
 */
export const createChatMemoryKafkaProducer = (cfg = {}) => {
  const enabled = cfg.enabled ?? env.chatMemoryKafka.enabled;
  const topic = cfg.topic ?? env.chatMemoryKafka.topic;
  const brokers = cfg.brokers ?? env.kafka.brokers;
  const log = cfg.log ?? logger;
  /** @type {Promise<any>|null} */
  let producerPromise = null;

  const getProducer = async () => {
    if (cfg.producer) return cfg.producer;
    if (!producerPromise) {
      producerPromise = (async () => {
        const kafka = cfg.kafka ?? await createKafkaClient();
        const producer = kafka.producer();
        await producer.connect();
        return producer;
      })();
    }
    return producerPromise;
  };

  return {
    enabled: enabled && brokers.length > 0,
    /**
     * @param {{ brandId: string, userId: string, conversationId: string }} key
     */
    publishChanged: async (key) => {
      if (!enabled) return false;
      if (brokers.length === 0 && !cfg.producer && !cfg.kafka) {
        log.warn(
          { event: 'chatmemory.kafka.disabled', reason: 'no_brokers' },
          'chat memory kafka producer enabled but KAFKA_BROKERS is empty',
        );
        return false;
      }

      const built = buildChatMemoryChangedEvent(key);
      try {
        const producer = await getProducer();
        await producer.send({
          topic,
          messages: [{
            key: built.key,
            value: JSON.stringify(built.event),
          }],
        });
        log.debug(
          {
            event: 'chatmemory.kafka.published',
            topic,
            brandId: key.brandId,
            userId: key.userId,
            conversationId: key.conversationId,
          },
          'chat memory kafka event published',
        );
        return true;
      } catch (err) {
        log.warn(
          {
            event: 'chatmemory.kafka.publish_failed',
            topic,
            brandId: key.brandId,
            userId: key.userId,
            conversationId: key.conversationId,
            err: String(err),
          },
          'chat memory kafka publish failed; continuing without archive event',
        );
        return false;
      }
    },
    disconnect: async () => {
      if (!producerPromise && !cfg.producer) return;
      try {
        const producer = cfg.producer ?? await producerPromise;
        if (producer && typeof producer.disconnect === 'function') await producer.disconnect();
      } finally {
        producerPromise = null;
      }
    },
  };
};

