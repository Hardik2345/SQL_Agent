import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.TENANT_ROUTER_URL = 'http://tenant-router:3004';
process.env.GATEWAY_TRUST_BYPASS = 'true';
process.env.MONGO_URI = '';

describe('insight.controller — chat history persistence', () => {
  let internal;

  before(async () => {
    ({ _internal: internal } = await import(
      '../../apps/api/src/controllers/insight.controller.js'
    ));
  });

  beforeEach(() => {
    internal.resetForTests();
  });

  it('persists user and assistant messages when conversationId is present', async () => {
    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      log: { warn: () => {} },
    };
    const request = {
      question: 'Show gross sales',
      context: { conversationId: 'chat-1', userId: 'ignored-because-req-user-wins' },
    };
    const response = {
      ok: true,
      correlationId: 'corr-1',
      result: {
        ok: true,
        columns: ['gross_sales'],
        rows: [{ gross_sales: 100 }],
        stats: { rowCount: 1, elapsedMs: 10, truncated: false },
      },
    };

    await internal.persistChatTurn({ req, request, response });
    const provider = await internal.getChatHistoryProvider();
    const out = await provider.getChat({ brandId: 'TMC', userId: 'u1', conversationId: 'chat-1' });

    assert.equal(out.chat.title, 'Show gross sales');
    assert.equal(out.chat.lastMessagePreview, 'Returned 1 row.');
    assert.equal(out.chat.lastResultSummary, 'rows=1; truncated=false');
    assert.deepEqual(out.messages.map((msg) => msg.role), ['user', 'assistant']);
    assert.equal(out.messages[0].content, 'Show gross sales');
    assert.equal(out.messages[1].type, 'execution');
    assert.deepEqual(out.messages[1].result.columns, ['gross_sales']);
    assert.equal(out.messages[1].correlationId, 'corr-1');
  });

  it('persists clarification responses as assistant message type', async () => {
    const req = {
      brandId: 'TMC',
      correlationId: 'corr-2',
      log: { warn: () => {} },
    };
    const request = {
      question: 'What is conversion rate?',
      context: { conversationId: 'chat-2', userId: 'u2' },
    };
    const response = {
      ok: true,
      correlationId: 'corr-2',
      result: {
        ok: false,
        type: 'clarification_required',
        question: 'How should conversion rate be calculated?',
        plan: { intent: 'needs_clarification', requiredMetrics: ['conversion_rate'] },
      },
    };

    await internal.persistChatTurn({ req, request, response });
    const provider = await internal.getChatHistoryProvider();
    const out = await provider.getChat({ brandId: 'TMC', userId: 'u2', conversationId: 'chat-2' });

    assert.equal(out.messages[1].type, 'clarification_required');
    assert.equal(out.messages[1].content, 'How should conversion rate be calculated?');
    assert.equal(out.messages[1].result.plan.requiredMetrics[0], 'conversion_rate');
  });

  it('does not persist when conversationId is absent', async () => {
    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-3',
      log: { warn: () => {} },
    };

    await internal.persistChatTurn({
      req,
      request: { question: 'No conversation', context: {} },
      response: { ok: true, result: { ok: true, stats: { rowCount: 0 } } },
    });

    const provider = await internal.getChatHistoryProvider();
    const out = await provider.listChats({ brandId: 'TMC', userId: 'u1' });
    assert.equal(out.chats.length, 0);
  });
});
