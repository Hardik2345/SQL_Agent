import { Router } from 'express';
import { queryInsight } from '../controllers/insight.controller.js';
import { tenantContextMiddleware } from '../middleware/tenantContext.middleware.js';

const router = Router();

/**
 * POST /insights/query
 * Body: { brandId?, question, context?, correlationId? }
 * Header: x-brand-id (preferred over body.brandId)
 */
router.post('/query', tenantContextMiddleware, queryInsight);

export default router;
