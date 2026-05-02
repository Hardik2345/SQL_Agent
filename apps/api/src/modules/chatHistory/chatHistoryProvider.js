import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const CONVERSATIONS_COLLECTION = 'chat_conversations';
const MESSAGES_COLLECTION = 'chat_messages';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * @typedef {Object} ChatIdentity
 * @property {string} brandId
 * @property {string} userId
 *
 * @typedef {Object} ChatConversation
 * @property {string} conversationId
 * @property {string} brandId
 * @property {string} userId
 * @property {string} title
 * @property {string|null} lastMessagePreview
 * @property {string|null} lastResultSummary
 * @property {Date} createdAt
 * @property {Date} updatedAt
 *
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {string} brandId
 * @property {string} userId
 * @property {string} conversationId
 * @property {'user'|'assistant'} role
 * @property {string} content
 * @property {Date} createdAt
 * @property {string} [type]
 * @property {Record<string, unknown>} [result]
 * @property {string} [correlationId]
 *
 * @typedef {Object} ChatHistoryProvider
 * @property {(args: ChatIdentity & { title?: string }) => Promise<ChatConversation>} createChat
 * @property {(args: ChatIdentity & { limit?: number, cursor?: string }) => Promise<{ chats: ChatConversation[], nextCursor: string|null }>} listChats
 * @property {(args: ChatIdentity & { conversationId: string }) => Promise<{ chat: ChatConversation, messages: ChatMessage[] }|null>} getChat
 * @property {(args: ChatIdentity & { conversationId: string }) => Promise<boolean>} deleteChat
 * @property {(args: ChatIdentity & { conversationId: string, title?: string, userMessage: Omit<ChatMessage, 'id'|'brandId'|'userId'|'conversationId'|'createdAt'>, assistantMessage: Omit<ChatMessage, 'id'|'brandId'|'userId'|'conversationId'|'createdAt'> }) => Promise<void>} appendTurn
 * @property {() => Promise<void>} clear
 */

const clampLimit = (value) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
};

const safeTitle = (value, fallback = 'New chat') => {
  const title = typeof value === 'string' ? value.trim() : '';
  return (title || fallback).slice(0, 120);
};

const previewText = (value) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, 180) : null;
};

const summarizeResult = (message) => {
  if (!message?.result || typeof message.result !== 'object') return null;
  const stats = message.result.stats;
  if (stats && typeof stats === 'object') {
    return `rows=${stats.rowCount ?? 0}; truncated=${stats.truncated === true}`;
  }
  if (message.type) return message.type;
  return null;
};

const serializeConversation = (doc) => ({
  conversationId: doc.conversationId,
  brandId: doc.brandId,
  userId: doc.userId,
  title: doc.title,
  lastMessagePreview: doc.lastMessagePreview ?? null,
  lastResultSummary: doc.lastResultSummary ?? null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const serializeMessage = (doc) => {
  const out = {
    id: doc.id,
    brandId: doc.brandId,
    userId: doc.userId,
    conversationId: doc.conversationId,
    role: doc.role,
    content: doc.content,
    createdAt: doc.createdAt,
  };
  if (doc.type) out.type = doc.type;
  if (doc.result !== undefined) out.result = doc.result;
  if (doc.correlationId) out.correlationId = doc.correlationId;
  return out;
};

const conversationSort = (a, b) =>
  b.updatedAt.getTime() - a.updatedAt.getTime() ||
  b.conversationId.localeCompare(a.conversationId);

const toDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const notFound = (conversationId) =>
  new AppError('Chat not found', {
    code: 'E_CHAT_NOT_FOUND',
    status: 404,
    details: { conversationId },
  });

export const createInMemoryChatHistoryProvider = () => {
  /** @type {Map<string, ChatConversation>} */
  const conversations = new Map();
  /** @type {Map<string, ChatMessage[]>} */
  const messages = new Map();

  const keyFor = ({ brandId, userId, conversationId }) =>
    `${brandId}:${userId}:${conversationId}`;

  const ensureConversation = ({ brandId, userId, conversationId, title, now }) => {
    const key = keyFor({ brandId, userId, conversationId });
    let chat = conversations.get(key);
    if (!chat) {
      chat = {
        conversationId,
        brandId,
        userId,
        title: safeTitle(title),
        lastMessagePreview: null,
        lastResultSummary: null,
        createdAt: now,
        updatedAt: now,
      };
      conversations.set(key, chat);
      messages.set(key, []);
    }
    return chat;
  };

  return {
    createChat: async ({ brandId, userId, title }) => {
      const now = new Date();
      const conversationId = randomUUID();
      const chat = ensureConversation({ brandId, userId, conversationId, title, now });
      return serializeConversation(chat);
    },
    listChats: async ({ brandId, userId, limit, cursor }) => {
      const n = clampLimit(limit);
      const cursorDate = cursor ? toDate(cursor) : null;
      const scoped = [...conversations.values()]
        .filter((chat) => chat.brandId === brandId && chat.userId === userId)
        .filter((chat) => !cursorDate || chat.updatedAt.getTime() < cursorDate.getTime())
        .sort(conversationSort);
      const page = scoped.slice(0, n);
      return {
        chats: page.map(serializeConversation),
        nextCursor: scoped.length > n ? page[page.length - 1]?.updatedAt.toISOString() ?? null : null,
      };
    },
    getChat: async ({ brandId, userId, conversationId }) => {
      const key = keyFor({ brandId, userId, conversationId });
      const chat = conversations.get(key);
      if (!chat) return null;
      return {
        chat: serializeConversation(chat),
        messages: (messages.get(key) ?? []).map(serializeMessage),
      };
    },
    deleteChat: async ({ brandId, userId, conversationId }) => {
      const key = keyFor({ brandId, userId, conversationId });
      const existed = conversations.delete(key);
      messages.delete(key);
      return existed;
    },
    appendTurn: async ({ brandId, userId, conversationId, title, userMessage, assistantMessage }) => {
      const now = new Date();
      const chat = ensureConversation({
        brandId,
        userId,
        conversationId,
        title: title ?? userMessage.content,
        now,
      });
      const key = keyFor({ brandId, userId, conversationId });
      if (!messages.has(key)) messages.set(key, []);
      const docs = [
        {
          id: randomUUID(),
          brandId,
          userId,
          conversationId,
          ...userMessage,
          createdAt: now,
        },
        {
          id: randomUUID(),
          brandId,
          userId,
          conversationId,
          ...assistantMessage,
          createdAt: new Date(now.getTime() + 1),
        },
      ];
      messages.get(key).push(...docs);
      chat.updatedAt = docs[1].createdAt;
      chat.lastMessagePreview = previewText(assistantMessage.content);
      chat.lastResultSummary = summarizeResult(assistantMessage);
    },
    clear: async () => {
      conversations.clear();
      messages.clear();
    },
  };
};

export const createMongoChatHistoryProvider = async ({
  uri,
  db = 'sql_agent',
  conversationsCollection = CONVERSATIONS_COLLECTION,
  messagesCollection = MESSAGES_COLLECTION,
}) => {
  if (!uri) return null;

  /** @type {any} */
  let mongoMod;
  try {
    const specifier = 'mongodb';
    mongoMod = await import(specifier);
  } catch (err) {
    logger.error(
      { event: 'chathistory.mongo.import_failed', err: String(err) },
      'mongodb package not installed; disabling mongo chat history',
    );
    return null;
  }

  const client = new mongoMod.MongoClient(uri);
  /** @type {any} */
  let conversations;
  /** @type {any} */
  let messages;
  let indexesEnsured = false;

  const ensureConnected = async () => {
    if (!conversations || !messages) {
      await client.connect();
      const database = client.db(db);
      conversations = database.collection(conversationsCollection);
      messages = database.collection(messagesCollection);
      logger.info(
        { event: 'chathistory.mongo.connected', db, conversationsCollection, messagesCollection },
        'mongodb chat history connected',
      );
    }
  };

  const ensureIndexes = async () => {
    if (indexesEnsured) return;
    await ensureConnected();
    await conversations.createIndex(
      { brandId: 1, userId: 1, conversationId: 1 },
      { unique: true, name: 'chat_history_identity_unique' },
    );
    await conversations.createIndex(
      { brandId: 1, userId: 1, updatedAt: -1 },
      { name: 'chat_history_tenant_user_updated_lookup' },
    );
    await messages.createIndex(
      { brandId: 1, userId: 1, conversationId: 1, createdAt: 1 },
      { name: 'chat_history_messages_lookup' },
    );
    indexesEnsured = true;
  };

  const upsertConversation = async ({ brandId, userId, conversationId, title, now }) => {
    await ensureIndexes();
    await conversations.updateOne(
      { brandId, userId, conversationId },
      {
        $setOnInsert: {
          brandId,
          userId,
          conversationId,
          title: safeTitle(title),
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    );
  };

  return {
    createChat: async ({ brandId, userId, title }) => {
      const now = new Date();
      const conversationId = randomUUID();
      await upsertConversation({ brandId, userId, conversationId, title, now });
      const doc = await conversations.findOne({ brandId, userId, conversationId });
      return serializeConversation(doc);
    },
    listChats: async ({ brandId, userId, limit, cursor }) => {
      await ensureIndexes();
      const n = clampLimit(limit);
      const cursorDate = cursor ? toDate(cursor) : null;
      const filter = { brandId, userId };
      if (cursorDate) filter.updatedAt = { $lt: cursorDate };
      const docs = await conversations
        .find(filter)
        .sort({ updatedAt: -1, conversationId: -1 })
        .limit(n + 1)
        .toArray();
      const page = docs.slice(0, n);
      return {
        chats: page.map(serializeConversation),
        nextCursor: docs.length > n ? page[page.length - 1]?.updatedAt.toISOString() ?? null : null,
      };
    },
    getChat: async ({ brandId, userId, conversationId }) => {
      await ensureIndexes();
      const chat = await conversations.findOne({ brandId, userId, conversationId });
      if (!chat) return null;
      const docs = await messages
        .find({ brandId, userId, conversationId })
        .sort({ createdAt: 1 })
        .toArray();
      return {
        chat: serializeConversation(chat),
        messages: docs.map(serializeMessage),
      };
    },
    deleteChat: async ({ brandId, userId, conversationId }) => {
      await ensureIndexes();
      const [convRes] = await Promise.all([
        conversations.deleteOne({ brandId, userId, conversationId }),
        messages.deleteMany({ brandId, userId, conversationId }),
      ]);
      return (convRes?.deletedCount ?? 0) > 0;
    },
    appendTurn: async ({ brandId, userId, conversationId, title, userMessage, assistantMessage }) => {
      const now = new Date();
      await upsertConversation({
        brandId,
        userId,
        conversationId,
        title: title ?? userMessage.content,
        now,
      });
      const docs = [
        {
          id: randomUUID(),
          brandId,
          userId,
          conversationId,
          ...userMessage,
          createdAt: now,
        },
        {
          id: randomUUID(),
          brandId,
          userId,
          conversationId,
          ...assistantMessage,
          createdAt: new Date(now.getTime() + 1),
        },
      ];
      await messages.insertMany(docs);
      await conversations.updateOne(
        { brandId, userId, conversationId },
        {
          $set: {
            updatedAt: docs[1].createdAt,
            lastMessagePreview: previewText(assistantMessage.content),
            lastResultSummary: summarizeResult(assistantMessage),
          },
        },
      );
    },
    clear: async () => {
      await ensureConnected();
      await conversations.deleteMany({});
      await messages.deleteMany({});
    },
  };
};

export const createChatHistoryProvider = async (options = {}) => {
  const provider = await createMongoChatHistoryProvider({
    uri: options.uri ?? env.mongo.uri,
    db: options.db ?? env.mongo.db,
  });
  if (provider) return provider;
  logger.warn(
    { event: 'chathistory.fallback', reason: 'no_mongo' },
    'using in-memory chat history',
  );
  return createInMemoryChatHistoryProvider();
};

export const _internal = {
  clampLimit,
  previewText,
  summarizeResult,
  safeTitle,
  notFound,
};
