import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInMemoryChatHistoryProvider,
  _internal,
} from '../../apps/api/src/modules/chatHistory/chatHistoryProvider.js';

const BASE = { brandId: 'TMC', userId: 'u1' };

describe('chatHistoryProvider — in-memory provider', () => {
  let provider;

  beforeEach(() => {
    provider = createInMemoryChatHistoryProvider();
  });

  it('creates server-generated tenant/user scoped chats', async () => {
    const chat = await provider.createChat({ ...BASE, title: 'My SQL chat' });

    assert.match(chat.conversationId, /^[0-9a-f-]{36}$/i);
    assert.equal(chat.brandId, 'TMC');
    assert.equal(chat.userId, 'u1');
    assert.equal(chat.title, 'My SQL chat');
    assert.equal(chat.lastMessagePreview, null);
    assert.equal(chat.lastResultSummary, null);
    assert.ok(chat.createdAt instanceof Date);
    assert.ok(chat.updatedAt instanceof Date);
  });

  it('lists only chats for the current brand and user, newest first', async () => {
    const first = await provider.createChat({ ...BASE, title: 'First' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await provider.createChat({ ...BASE, title: 'Second' });
    await provider.createChat({ brandId: 'OTHER', userId: 'u1', title: 'Other tenant' });
    await provider.createChat({ brandId: 'TMC', userId: 'u2', title: 'Other user' });

    const out = await provider.listChats({ ...BASE, limit: 10 });

    assert.deepEqual(
      out.chats.map((chat) => chat.conversationId),
      [second.conversationId, first.conversationId],
    );
    assert.equal(out.nextCursor, null);
  });

  it('returns a chat with ordered messages', async () => {
    const chat = await provider.createChat({ ...BASE, title: 'Fetch me' });

    await provider.appendTurn({
      ...BASE,
      conversationId: chat.conversationId,
      title: 'Show sales',
      userMessage: { role: 'user', content: 'Show sales' },
      assistantMessage: {
        role: 'assistant',
        content: 'Returned 1 row.',
        type: 'execution',
        result: { ok: true, columns: ['sales'], rows: [{ sales: 10 }], stats: { rowCount: 1, truncated: false } },
      },
    });

    const out = await provider.getChat({ ...BASE, conversationId: chat.conversationId });

    assert.equal(out.chat.title, 'Fetch me');
    assert.equal(out.messages.length, 2);
    assert.equal(out.messages[0].role, 'user');
    assert.equal(out.messages[0].content, 'Show sales');
    assert.equal(out.messages[1].role, 'assistant');
    assert.equal(out.messages[1].type, 'execution');
    assert.deepEqual(out.messages[1].result.columns, ['sales']);
  });

  it('appendTurn implicitly creates a chat using the first question as title', async () => {
    await provider.appendTurn({
      ...BASE,
      conversationId: 'server-id',
      title: 'What happened yesterday?',
      userMessage: { role: 'user', content: 'What happened yesterday?' },
      assistantMessage: {
        role: 'assistant',
        content: 'Returned 0 rows.',
        type: 'execution',
        result: { ok: true, columns: [], rows: [], stats: { rowCount: 0, truncated: false } },
      },
    });

    const out = await provider.getChat({ ...BASE, conversationId: 'server-id' });

    assert.equal(out.chat.title, 'What happened yesterday?');
    assert.equal(out.chat.lastMessagePreview, 'Returned 0 rows.');
    assert.equal(out.chat.lastResultSummary, 'rows=0; truncated=false');
    assert.equal(out.messages.length, 2);
  });

  it('supports cursor pagination', async () => {
    await provider.createChat({ ...BASE, title: 'One' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await provider.createChat({ ...BASE, title: 'Two' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await provider.createChat({ ...BASE, title: 'Three' });

    const page1 = await provider.listChats({ ...BASE, limit: 2 });
    const page2 = await provider.listChats({ ...BASE, limit: 2, cursor: page1.nextCursor });

    assert.deepEqual(page1.chats.map((chat) => chat.title), ['Three', 'Two']);
    assert.equal(page1.nextCursor, page1.chats[1].updatedAt.toISOString());
    assert.deepEqual(page2.chats.map((chat) => chat.title), ['One']);
    assert.equal(page2.nextCursor, null);
  });

  it('deletes a chat and its messages', async () => {
    const chat = await provider.createChat({ ...BASE, title: 'Delete me' });
    await provider.appendTurn({
      ...BASE,
      conversationId: chat.conversationId,
      title: 'Q',
      userMessage: { role: 'user', content: 'Q' },
      assistantMessage: { role: 'assistant', content: 'A', type: 'execution', result: { ok: true } },
    });

    const deleted = await provider.deleteChat({ ...BASE, conversationId: chat.conversationId });
    const out = await provider.getChat({ ...BASE, conversationId: chat.conversationId });

    assert.equal(deleted, true);
    assert.equal(out, null);
  });

  it('returns false when deleting a missing chat', async () => {
    const deleted = await provider.deleteChat({ ...BASE, conversationId: 'missing' });
    assert.equal(deleted, false);
  });
});

describe('chatHistoryProvider — helpers', () => {
  it('clamps list limits and builds previews/result summaries', () => {
    assert.equal(_internal.clampLimit('0'), 1);
    assert.equal(_internal.clampLimit('500'), 100);
    assert.equal(_internal.previewText('hello\n   world'), 'hello world');
    assert.equal(
      _internal.summarizeResult({ result: { stats: { rowCount: 3, truncated: true } } }),
      'rows=3; truncated=true',
    );
  });
});
