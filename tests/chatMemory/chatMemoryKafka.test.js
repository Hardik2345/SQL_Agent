import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatMemoryChangedEvent,
  createChatMemoryKafkaProducer,
  parseChatMemoryChangedEvent,
} from '../../apps/api/src/modules/chatMemory/chatMemoryKafkaProducer.js';
import {
  createChatMemoryKafkaBatcher,
  flushChatMemoryKafkaBatch,
} from '../../scripts/sync-chat-memory-kafka.js';

const KEY = { brandId: 'TMC', userId: 'u1', conversationId: 'c1' };

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

class FakeRedis {
  constructor(seed = {}) {
    this.isOpen = false;
    this.store = new Map(Object.entries(seed));
  }

  async connect() {
    this.isOpen = true;
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }
}

const createArchive = () => {
  const docs = [];
  return {
    docs,
    async ensureIndexes() {},
    async getSnapshot() {
      return null;
    },
    async upsertSnapshot(item) {
      docs.push(item);
    },
    async upsertSnapshots(items) {
      docs.push(...items);
      return items.length;
    },
    async clear() {
      docs.length = 0;
    },
  };
};

describe('chat memory Kafka producer', () => {
  it('builds a stable pointer-only event', () => {
    const built = buildChatMemoryChangedEvent({
      ...KEY,
      now: new Date('2026-04-27T00:00:00.000Z'),
    });
    assert.equal(built.key, 'TMC:u1:c1');
    assert.deepEqual(built.event, {
      type: 'chat_memory_changed',
      version: 1,
      brandId: 'TMC',
      userId: 'u1',
      conversationId: 'c1',
      redisKey: 'sql-agent:chat:TMC:u1:c1',
      updatedAt: '2026-04-27T00:00:00.000Z',
    });
    assert.deepEqual(parseChatMemoryChangedEvent(JSON.stringify(built.event)), built.event);
  });

  it('does nothing when disabled', async () => {
    let sendCalled = false;
    const producer = createChatMemoryKafkaProducer({
      enabled: false,
      brokers: ['localhost:9092'],
      log: silentLog,
      producer: {
        send: async () => {
          sendCalled = true;
        },
      },
    });

    const published = await producer.publishChanged(KEY);
    assert.equal(published, false);
    assert.equal(sendCalled, false);
  });

  it('logs and swallows producer send failures', async () => {
    let warnCalled = false;
    const producer = createChatMemoryKafkaProducer({
      enabled: true,
      brokers: ['localhost:9092'],
      log: { ...silentLog, warn: () => { warnCalled = true; } },
      producer: {
        send: async () => {
          throw new Error('kafka down');
        },
      },
    });

    const published = await producer.publishChanged(KEY);
    assert.equal(published, false);
    assert.equal(warnCalled, true);
  });
});

describe('chat memory Kafka batcher', () => {
  it('dedupes repeated conversation events before flushing', async () => {
    const flushed = [];
    const committed = [];
    const batcher = createChatMemoryKafkaBatcher({
      batchSize: 2,
      flushMs: 0,
      flush: async (items) => {
        flushed.push(items);
      },
      commit: async (offsets) => {
        committed.push(offsets);
      },
    });

    const event1 = buildChatMemoryChangedEvent(KEY).event;
    const event2 = buildChatMemoryChangedEvent({ ...KEY, conversationId: 'c2' }).event;
    await batcher.add({
      event: event1,
      offset: { topic: 't', partition: 0, offset: '3' },
    });
    await batcher.add({
      event: { ...event1, updatedAt: 'later' },
      offset: { topic: 't', partition: 0, offset: '4' },
    });
    assert.equal(batcher.size(), 1);
    await batcher.add({
      event: event2,
      offset: { topic: 't', partition: 0, offset: '5' },
    });

    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].length, 2);
    assert.equal(flushed[0][0].event.updatedAt, 'later');
    assert.deepEqual(committed[0], [{ topic: 't', partition: 0, offset: '6' }]);
  });

  it('flushes when the timer fires', async () => {
    /** @type {Function|null} */
    let timerCallback = null;
    const flushed = [];
    const batcher = createChatMemoryKafkaBatcher({
      batchSize: 10,
      flushMs: 5000,
      flush: async (items) => {
        flushed.push(items);
      },
      setTimer: (cb) => {
        timerCallback = cb;
        return 1;
      },
      clearTimer: () => {},
    });

    await batcher.add({ event: buildChatMemoryChangedEvent(KEY).event });
    assert.equal(flushed.length, 0);
    const fireTimer = timerCallback;
    if (!fireTimer) throw new Error('expected timer callback');
    await fireTimer();
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].length, 1);
  });
});

describe('chat memory Kafka flush', () => {
  it('reads latest Redis snapshots and bulk upserts Mongo archive docs', async () => {
    const event = buildChatMemoryChangedEvent(KEY).event;
    const redis = new FakeRedis({
      [event.redisKey]: JSON.stringify({
        previousQuestions: ['latest question'],
        confirmedMetricDefinitions: { cm: 'net - discounts' },
      }),
    });
    const archive = createArchive();

    const stats = await flushChatMemoryKafkaBatch({
      redisClient: redis,
      archive,
      items: [
        { event: { ...event, updatedAt: 'older' } },
        { event: { ...event, updatedAt: 'newer' } },
      ],
      log: silentLog,
    });

    assert.equal(stats.received, 2);
    assert.equal(stats.deduped, 1);
    assert.equal(stats.persisted, 1);
    assert.equal(archive.docs.length, 1);
    assert.deepEqual(archive.docs[0].memory.previousQuestions, ['latest question']);
    assert.equal(archive.docs[0].memory.confirmedMetricDefinitions.cm, 'net - discounts');
  });

  it('skips malformed Redis JSON without failing the batch', async () => {
    const event = buildChatMemoryChangedEvent(KEY).event;
    const redis = new FakeRedis({ [event.redisKey]: '{bad-json' });
    const archive = createArchive();

    const stats = await flushChatMemoryKafkaBatch({
      redisClient: redis,
      archive,
      items: [{ event }],
      log: silentLog,
    });

    assert.equal(stats.persisted, 0);
    assert.equal(stats.parseFailures, 1);
    assert.equal(archive.docs.length, 0);
  });
});
