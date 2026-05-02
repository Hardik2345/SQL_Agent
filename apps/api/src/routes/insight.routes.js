import { Router } from 'express';
import {
	createChat,
	deleteChat,
	getChat,
	listChats,
} from '../controllers/chat.controller.js';
import { queryInsight } from '../controllers/insight.controller.js';
import { tenantContextMiddleware } from '../middleware/tenantContext.middleware.js';

const router = Router();

/**
 * POST /insights/query
 * Body: { brandId?, question, context?, correlationId? }
 * Header: x-brand-id (preferred over body.brandId)
 */
router.post('/query', tenantContextMiddleware, queryInsight);
router.post('/chats', tenantContextMiddleware, createChat);
router.get('/chats', tenantContextMiddleware, listChats);
router.get('/chats/:conversationId', tenantContextMiddleware, getChat);
router.delete('/chats/:conversationId', tenantContextMiddleware, deleteChat);

export default router;
