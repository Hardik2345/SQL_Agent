import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createChatMemoryProvider,
  normalizeChatContext,
  mergeChatContext,
  _internal,
} from '../../apps/api/src/modules/chatMemory/chatMemoryProvider.js';

const KEY = { brandId: 'BRAND', userId: 'u1', conversationId: 'c1' };

describe('chatMemory — normalize + merge helpers', () => {
  it('normalizes null/undefined into a fully-populated empty context', () => {
    const ctx = normalizeChatContext(null);
    assert.deepEqual(ctx.previousQuestions, []);
    assert.deepEqual(ctx.confirmedMetricDefinitions, {});
    assert.deepEqual(ctx.lastUsedFilters, []);
    assert.deepEqual(ctx.lastFilterRefs, []);
    assert.deepEqual(ctx.lastMetricRefs, []);
    assert.equal(ctx.lastResultSummary, null);
  });

  it('mergeChatContext appends previousQuestions (capped at 10)', () => {
    let ctx = mergeChatContext({}, { previousQuestions: ['q1', 'q2'] });
    ctx = mergeChatContext(ctx, { previousQuestions: ['q3'] });
    assert.deepEqual(ctx.previousQuestions, ['q1', 'q2', 'q3']);

    // Cap at 10
    let big = normalizeChatContext({});
    for (let i = 0; i < 15; i++) big = mergeChatContext(big, { previousQuestions: [`q${i}`] });
    assert.equal(big.previousQuestions.length, 10);
    assert.equal(big.previousQuestions[0], 'q5');
    assert.equal(big.previousQuestions[9], 'q14');
  });

  it('mergeChatContext lets delta confirmedMetricDefinitions win', () => {
    const ctx = mergeChatContext(
      { confirmedMetricDefinitions: { a: 'old', b: 'keep' } },
      { confirmedMetricDefinitions: { a: 'new' } },
    );
    assert.equal(ctx.confirmedMetricDefinitions.a, 'new');
    assert.equal(ctx.confirmedMetricDefinitions.b, 'keep');
  });

  it('mergeChatContext replaces filters/metric refs (no append semantics)', () => {
    const ctx = mergeChatContext(
      { lastMetricRefs: ['x'], lastFilterRefs: [{ kind: 'a' }] },
      { lastMetricRefs: ['y', 'z'], lastFilterRefs: [{ kind: 'b' }] },
    );
    assert.deepEqual(ctx.lastMetricRefs, ['y', 'z']);
    assert.equal(ctx.lastFilterRefs.length, 1);
    assert.equal(ctx.lastFilterRefs[0].kind, 'b');
  });
});

describe('chatMemory — in-memory provider', () => {
  /** @type {ReturnType<typeof _internal.createInMemoryChatMemoryProvider>} */
  let provider;
  beforeEach(() => {
    provider = _internal.createInMemoryChatMemoryProvider({ ttlSeconds: 60 });
  });

  it('returns a normalized empty context for unknown keys', async () => {
    const ctx = await provider.getChatContext(KEY);
    assert.deepEqual(ctx.previousQuestions, []);
    assert.deepEqual(ctx.confirmedMetricDefinitions, {});
  });

  it('updateChatContext persists and merges across calls', async () => {
    await provider.updateChatContext({
      ...KEY,
      memoryDelta: {
        previousQuestions: ['hello?'],
        confirmedMetricDefinitions: { aov: 'gross / orders' },
      },
    });
    await provider.updateChatContext({
      ...KEY,
      memoryDelta: { previousQuestions: ['world?'] },
    });
    const ctx = await provider.getChatContext(KEY);
    assert.deepEqual(ctx.previousQuestions, ['hello?', 'world?']);
    assert.equal(ctx.confirmedMetricDefinitions.aov, 'gross / orders');
  });

  it('TTL is respected — entries past expiry return empty context', async () => {
    let now = 1_000_000;
    const p = _internal.createInMemoryChatMemoryProvider({ ttlSeconds: 5, now: () => now });
    await p.updateChatContext({
      ...KEY,
      memoryDelta: { previousQuestions: ['hi'] },
    });
    now += 4_999;
    const before = await p.getChatContext(KEY);
    assert.equal(before.previousQuestions.length, 1);
    now += 1_000; // total 5,999 ms past write (> 5s)
    const after = await p.getChatContext(KEY);
    assert.deepEqual(after.previousQuestions, []);
  });

  it('keys are tenant-scoped — different brandId yields a fresh context', async () => {
    await provider.updateChatContext({
      ...KEY,
      memoryDelta: { previousQuestions: ['only for brand A'] },
    });
    const otherTenant = await provider.getChatContext({ ...KEY, brandId: 'OTHER_BRAND' });
    assert.deepEqual(otherTenant.previousQuestions, []);
  });
});

describe('createChatMemoryProvider — env-driven default', () => {
  it('falls back to in-memory when REDIS_URL is unset', async () => {
    const p = await createChatMemoryProvider({ url: '' });
    assert.equal(p.mock, true);
  });
});
