import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatMemoryArchiveDocument,
  chatMemoryRedisKeyFor,
  parseChatMemoryRedisKey,
} from '../../apps/api/src/modules/chatMemory/chatMemoryArchive.js';
import { _internal as chatMemoryInternal } from '../../apps/api/src/modules/chatMemory/chatMemoryProvider.js';
import { syncChatMemoryOnce } from '../../scripts/sync-chat-memory.js';

const KEY = { brandId: 'TMC', userId: 'u1', conversationId: 'c1' };

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

class FakeRedis {
  constructor(seed = {}) {
    this.isOpen = false;
    this.store = new Map(Object.entries(seed));
    this.setCalls = [];
  }

  async connect() {
    this.isOpen = true;
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async set(key, value, options) {
    this.setCalls.push({ key, value, options });
    this.store.set(key, value);
  }

  async *scanIterator() {
    for (const key of this.store.keys()) yield key;
  }
}

const createFakeArchive = () => {
  const docs = new Map();
  return {
    docs,
    ensureIndexesCalls: 0,
    async ensureIndexes() {
      this.ensureIndexesCalls += 1;
    },
    async getSnapshot({ brandId, userId, conversationId }) {
      return docs.get(`${brandId}:${userId}:${conversationId}`)?.memory ?? null;
    },
    async upsertSnapshot({ brandId, userId, conversationId, memory, redisKey }) {
      docs.set(`${brandId}:${userId}:${conversationId}`, {
        brandId,
        userId,
        conversationId,
        redisKey,
        memory,
      });
    },
    async upsertSnapshots(items) {
      for (const item of items) {
        await this.upsertSnapshot(item);
      }
      return items.length;
    },
    async clear() {
      docs.clear();
    },
  };
};

describe('chatMemoryArchive — key + document helpers', () => {
  it('builds and parses Redis chat memory keys', () => {
    const redisKey = chatMemoryRedisKeyFor(KEY);
    assert.equal(redisKey, 'sql-agent:chat:TMC:u1:c1');
    assert.deepEqual(parseChatMemoryRedisKey(redisKey), { ...KEY, redisKey });
  });

  it('normalizes archive documents and computes expiresAt', () => {
    const now = new Date('2026-04-27T00:00:00.000Z');
    const doc = buildChatMemoryArchiveDocument({
      redisKey: chatMemoryRedisKeyFor(KEY),
      memory: { previousQuestions: ['q1'], confirmedMetricDefinitions: { cm: 'net - discounts' } },
      ttlSeconds: 60,
      now,
    });
    assert.deepEqual(doc.memory.previousQuestions, ['q1']);
    assert.equal(doc.memory.confirmedMetricDefinitions.cm, 'net - discounts');
    assert.equal(doc.expiresAt.toISOString(), '2026-04-27T00:01:00.000Z');
  });
});

describe('chatMemory sync — one-shot', () => {
  it('persists multiple Redis keys into the archive sink', async () => {
    const key1 = chatMemoryRedisKeyFor(KEY);
    const key2 = chatMemoryRedisKeyFor({ ...KEY, conversationId: 'c2' });
    const redis = new FakeRedis({
      [key1]: JSON.stringify({ previousQuestions: ['q1'] }),
      [key2]: JSON.stringify({ previousQuestions: ['q2'] }),
    });
    const archive = createFakeArchive();

    const stats = await syncChatMemoryOnce({
      redisClient: redis,
      archive,
      batchSize: 100,
      log: silentLog,
    });

    assert.equal(stats.scanned, 2);
    assert.equal(stats.persisted, 2);
    assert.equal(archive.docs.size, 2);
    assert.deepEqual(archive.docs.get('TMC:u1:c1').memory.previousQuestions, ['q1']);
    assert.deepEqual(archive.docs.get('TMC:u1:c2').memory.previousQuestions, ['q2']);
  });

  it('skips bad JSON values without failing the whole sync', async () => {
    const goodKey = chatMemoryRedisKeyFor(KEY);
    const badKey = chatMemoryRedisKeyFor({ ...KEY, conversationId: 'bad' });
    const redis = new FakeRedis({
      [goodKey]: JSON.stringify({ previousQuestions: ['q1'] }),
      [badKey]: '{not-json',
    });
    const archive = createFakeArchive();

    const stats = await syncChatMemoryOnce({
      redisClient: redis,
      archive,
      log: silentLog,
    });

    assert.equal(stats.scanned, 2);
    assert.equal(stats.persisted, 1);
    assert.equal(stats.parseFailures, 1);
    assert.equal(archive.docs.size, 1);
  });

  it('supports Redis cache clear followed by Mongo fallback restore', async () => {
    const redisKey = chatMemoryRedisKeyFor(KEY);
    const redis = new FakeRedis({
      [redisKey]: JSON.stringify({
        previousQuestions: ['define contribution margin'],
        confirmedMetricDefinitions: { contribution_margin: 'net sales - discounts' },
      }),
    });
    const archive = createFakeArchive();
    await syncChatMemoryOnce({ redisClient: redis, archive, log: silentLog });

    redis.store.clear();
    const provider = await chatMemoryInternal.createRedisChatMemoryProvider({
      url: 'redis://fake',
      ttlSeconds: 60,
      client: redis,
      archive,
    });

    const restored = await provider.getChatContext(KEY);
    assert.equal(
      restored.confirmedMetricDefinitions.contribution_margin,
      'net sales - discounts',
    );
    assert.equal(redis.setCalls.length, 1);
  });
});
