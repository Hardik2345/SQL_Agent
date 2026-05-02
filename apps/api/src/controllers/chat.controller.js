import { createChatHistoryProvider } from '../modules/chatHistory/chatHistoryProvider.js';
import { createChatMemoryProvider } from '../modules/chatMemory/chatMemoryProvider.js';
import { AppError, toAppError } from '../utils/errors.js';

/** @type {import('../modules/chatHistory/chatHistoryProvider.js').ChatHistoryProvider|null} */
let cachedProvider = null;
/** @type {import('../modules/chatMemory/chatMemoryProvider.js').ChatMemoryProvider|null} */
let cachedMemoryProvider = null;

const getProvider = async () => {
  if (!cachedProvider) cachedProvider = await createChatHistoryProvider();
  return cachedProvider;
};

const getMemoryProvider = async () => {
  if (!cachedMemoryProvider) cachedMemoryProvider = await createChatMemoryProvider();
  return cachedMemoryProvider;
};

export const _resetChatHistoryProviderForTests = () => {
  cachedProvider = null;
  cachedMemoryProvider = null;
};

export const userIdForRequest = (req) => {
  const ctxUserId = req.body?.context?.userId;
  return req.userId || (typeof ctxUserId === 'string' && ctxUserId.trim()) || 'anonymous';
};

const serializeDate = (value) => {
  if (value instanceof Date) return value.toISOString();
  return value;
};

export const serializeChat = (chat) => ({
  ...chat,
  createdAt: serializeDate(chat.createdAt),
  updatedAt: serializeDate(chat.updatedAt),
});

export const serializeMessage = (message) => ({
  ...message,
  createdAt: serializeDate(message.createdAt),
});

const notFound = (conversationId) =>
  new AppError('Chat not found', {
    code: 'E_CHAT_NOT_FOUND',
    status: 404,
    details: { conversationId },
  });

export const createChat = async (req, res, next) => {
  try {
    const provider = await getProvider();
    const chat = await provider.createChat({
      brandId: req.brandId,
      userId: userIdForRequest(req),
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
    });
    return res.status(201).json({
      ok: true,
      correlationId: req.correlationId,
      chat: serializeChat(chat),
    });
  } catch (err) {
    return next(toAppError(err));
  }
};

export const listChats = async (req, res, next) => {
  try {
    const provider = await getProvider();
    const out = await provider.listChats({
      brandId: req.brandId,
      userId: userIdForRequest(req),
      limit: req.query?.limit,
      cursor: typeof req.query?.cursor === 'string' ? req.query.cursor : undefined,
    });
    return res.status(200).json({
      ok: true,
      correlationId: req.correlationId,
      chats: out.chats.map(serializeChat),
      nextCursor: out.nextCursor,
    });
  } catch (err) {
    return next(toAppError(err));
  }
};

export const getChat = async (req, res, next) => {
  const conversationId = req.params?.conversationId;
  try {
    const provider = await getProvider();
    const out = await provider.getChat({
      brandId: req.brandId,
      userId: userIdForRequest(req),
      conversationId,
    });
    if (!out) throw notFound(conversationId);
    return res.status(200).json({
      ok: true,
      correlationId: req.correlationId,
      chat: serializeChat(out.chat),
      messages: out.messages.map(serializeMessage),
    });
  } catch (err) {
    return next(toAppError(err));
  }
};

export const deleteChat = async (req, res, next) => {
  const conversationId = req.params?.conversationId;
  try {
    const provider = await getProvider();
    const deleted = await provider.deleteChat({
      brandId: req.brandId,
      userId: userIdForRequest(req),
      conversationId,
    });
    if (!deleted) throw notFound(conversationId);

    const memoryProvider = await getMemoryProvider();
    await memoryProvider.deleteChatContext({
      brandId: req.brandId,
      userId: userIdForRequest(req),
      conversationId,
    });

    return res.status(200).json({
      ok: true,
      correlationId: req.correlationId,
      deleted: true,
      conversationId,
    });
  } catch (err) {
    return next(toAppError(err));
  }
};

export const _internal = {
  getProvider,
  getMemoryProvider,
  userIdForRequest,
  serializeChat,
  serializeMessage,
};
