import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.TENANT_ROUTER_URL = 'http://tenant-router:3004';
process.env.GATEWAY_TRUST_BYPASS = 'true';
process.env.MONGO_URI = '';

const createRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
};

describe('chat.controller', () => {
  let controller;

  before(async () => {
    controller = await import('../../apps/api/src/controllers/chat.controller.js');
  });

  beforeEach(() => {
    controller._resetChatHistoryProviderForTests();
  });

  it('POST /insights/chats creates a chat envelope', async () => {
    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      body: { title: 'Frontend chat' },
    };
    const res = createRes();

    await controller.createChat(req, res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.match(res.body.chat.conversationId, /^[0-9a-f-]{36}$/i);
    assert.equal(res.body.chat.title, 'Frontend chat');
    assert.equal(res.body.chat.brandId, 'TMC');
    assert.equal(res.body.chat.userId, 'u1');
  });

  it('GET /insights/chats lists only current brand/user chats', async () => {
    const provider = await controller._internal.getProvider();
    await provider.createChat({ brandId: 'TMC', userId: 'u1', title: 'Visible' });
    await provider.createChat({ brandId: 'TMC', userId: 'u2', title: 'Hidden user' });
    await provider.createChat({ brandId: 'PTS', userId: 'u1', title: 'Hidden brand' });

    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      query: {},
      body: {},
    };
    const res = createRes();

    await controller.listChats(req, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.chats.map((chat) => chat.title), ['Visible']);
  });

  it('GET /insights/chats/:conversationId returns chat messages', async () => {
    const provider = await controller._internal.getProvider();
    await provider.appendTurn({
      brandId: 'TMC',
      userId: 'u1',
      conversationId: 'chat-1',
      title: 'Question',
      userMessage: { role: 'user', content: 'Question' },
      assistantMessage: { role: 'assistant', content: 'Answer', type: 'execution', result: { ok: true } },
    });
    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      params: { conversationId: 'chat-1' },
      body: {},
    };
    const res = createRes();

    await controller.getChat(req, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.chat.conversationId, 'chat-1');
    assert.deepEqual(res.body.messages.map((msg) => msg.role), ['user', 'assistant']);
    assert.equal(res.body.messages[1].content, 'Answer');
  });

  it('GET /insights/chats/:conversationId rejects cross-user access', async () => {
    const provider = await controller._internal.getProvider();
    await provider.createChat({ brandId: 'TMC', userId: 'u2', title: 'Hidden' });
    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      params: { conversationId: 'missing' },
      body: {},
    };
    const res = createRes();
    /** @type {any} */
    let nextError = null;

    await controller.getChat(req, res, (err) => {
      nextError = err;
    });

    assert.equal(res.body, null);
    assert.ok(nextError);
    assert.equal(nextError.code, 'E_CHAT_NOT_FOUND');
    assert.equal(nextError.status, 404);
  });

  it('DELETE /insights/chats/:conversationId deletes chat and invalidates memory context', async () => {
    const provider = await controller._internal.getProvider();
    const memoryProvider = await controller._internal.getMemoryProvider();
    const chat = await provider.createChat({ brandId: 'TMC', userId: 'u1', title: 'To delete' });
    await memoryProvider.updateChatContext({
      brandId: 'TMC',
      userId: 'u1',
      conversationId: chat.conversationId,
      memoryDelta: { previousQuestions: ['q1'] },
    });

    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      params: { conversationId: chat.conversationId },
      body: {},
    };
    const res = createRes();

    await controller.deleteChat(req, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deleted, true);
    const out = await provider.getChat({ brandId: 'TMC', userId: 'u1', conversationId: chat.conversationId });
    assert.equal(out, null);
    const memory = await memoryProvider.getChatContext({
      brandId: 'TMC',
      userId: 'u1',
      conversationId: chat.conversationId,
    });
    assert.deepEqual(memory.previousQuestions, []);
  });

  it('DELETE /insights/chats/:conversationId returns E_CHAT_NOT_FOUND for missing chat', async () => {
    const req = {
      brandId: 'TMC',
      userId: 'u1',
      correlationId: 'corr-1',
      params: { conversationId: 'missing' },
      body: {},
    };
    const res = createRes();
    /** @type {any} */
    let nextError = null;

    await controller.deleteChat(req, res, (err) => {
      nextError = err;
    });

    assert.equal(res.body, null);
    assert.ok(nextError);
    assert.equal(nextError.code, 'E_CHAT_NOT_FOUND');
    assert.equal(nextError.status, 404);
  });
});
