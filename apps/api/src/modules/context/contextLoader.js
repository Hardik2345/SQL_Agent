import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { createChatMemoryProvider, normalizeChatContext } from '../chatMemory/chatMemoryProvider.js';
import { createSemanticProvider, metricsToGlobalContext } from '../semantic/semanticProvider.js';
import { createVectorClient } from '../vector/vectorClient.js';

/**
 * @typedef {import('../contracts/agentState.js').ChatContext} ChatContext
 * @typedef {import('../contracts/agentState.js').GlobalContext} GlobalContext
 * @typedef {import('../contracts/agentState.js').RetrievalContext} RetrievalContext
 * @typedef {import('../contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 *
 * @typedef {Object} ContextLoaderResult
 * @property {ChatContext}        chatContext
 * @property {GlobalContext}      globalContext
 * @property {RetrievalContext}   retrievalContext
 *
 * @typedef {Object} ContextLoader
 * @property {(args: { request: QueryRequest, tenant: TenantExecutionContext, conversationId?: string, userId?: string, correlationId?: string }) => Promise<ContextLoaderResult>} load
 */

const DEFAULT_USER_ID = 'anonymous';
const DEFAULT_CONVERSATION_ID = 'default';

/**
 * Hybrid retrieval pipeline. Priority order, per the Phase 2D spec:
 *
 *   1. `chatContext.confirmedMetricDefinitions` — wins on conflict.
 *   2. Semantic catalog exact lookup by metric name (synonyms too).
 *   3. Vector candidates → catalog round-trip.
 *   4. Otherwise: leave the metric unresolved; the planner returns
 *      `needs_clarification`.
 *
 * The caller never sees the vector store directly — the planner only
 * gets `globalContext.metrics` (truth from the catalog) plus
 * `chatContext.confirmedMetricDefinitions` (user overrides).
 * `retrievalContext` is exposed purely for traces/logs.
 *
 * @param {{
 *   chatMemory: import('../chatMemory/chatMemoryProvider.js').ChatMemoryProvider,
 *   semantic:   import('./../semantic/semantic.types.js').SemanticCatalog,
 *   vector:     import('../vector/vectorClient.js').VectorClient,
 *   topK?:      number,
 * }} deps
 * @returns {ContextLoader}
 */
export const createContextLoader = (deps) => {
  const { chatMemory, semantic, vector } = deps;
  const topK = deps.topK ?? env.retrieval.topK;

  return {
    load: async ({ request, tenant, conversationId, userId, correlationId }) => {
      if (!request || typeof request.question !== 'string') {
        throw new Error('contextLoader.load requires request.question');
      }
      if (!tenant || typeof tenant.brandId !== 'string') {
        throw new Error('contextLoader.load requires tenant.brandId');
      }

      const memKey = {
        brandId: tenant.brandId,
        userId: userId || DEFAULT_USER_ID,
        conversationId: conversationId || DEFAULT_CONVERSATION_ID,
      };

      const chatContext = normalizeChatContext(
        await chatMemory.getChatContext(memKey),
      );

      // 1. Vector candidates. Failure here is non-fatal — the
      //    semantic catalog still works on its own.
      /** @type {Array<{metricId: string, score: number}>} */
      let candidates = [];
      try {
        candidates = await vector.searchSimilarMetrics({
          tenantId: tenant.brandId,
          query: request.question,
          topK,
        });
      } catch (err) {
        logger.warn(
          { event: 'context.vector.error', err: String(err), correlationId },
          'vector search failed; continuing without candidates',
        );
      }

      const candidateIds = Array.from(
        new Set(
          candidates
            .map((c) => c.metricId)
            .filter((id) => typeof id === 'string' && id.length > 0),
        ),
      );

      // 2 + 3. Pull definitions from the catalog. Failure here is
      // also non-fatal: planner just sees fewer formulas and may
      // clarify more often.
      /** @type {import('../semantic/semantic.types.js').SemanticMetric[]} */
      let metrics = [];
      if (candidateIds.length > 0) {
        try {
          metrics = await semantic.getMetricsByIds(candidateIds, tenant.brandId);
        } catch (err) {
          logger.warn(
            { event: 'context.catalog.error', err: String(err), correlationId },
            'semantic catalog lookup failed',
          );
        }
      }

      const resolvedMetricIds = metrics.map((m) => m.metricId);

      /** @type {GlobalContext} */
      const globalContext = {
        metrics: metricsToGlobalContext(metrics),
        glossary: {},
        synonyms: {},
      };

      /** @type {RetrievalContext} */
      const retrievalContext = {
        vectorCandidates: candidates,
        resolvedMetricIds,
        source: deriveSource({
          chatContext,
          candidatesCount: candidates.length,
          resolvedCount: resolvedMetricIds.length,
        }),
        debug: {
          mockChatMemory: chatMemory.mock === true,
          mockVector: vector.mock === true,
          topK,
        },
      };

      logger.info(
        {
          event: 'context.loaded',
          correlationId,
          brandId: tenant.brandId,
          conversationId: memKey.conversationId,
          userId: memKey.userId,
          candidatesCount: candidates.length,
          resolvedCount: resolvedMetricIds.length,
          confirmedCount: Object.keys(chatContext.confirmedMetricDefinitions).length,
          source: retrievalContext.source,
        },
        'context loader produced grounding',
      );

      return { chatContext, globalContext, retrievalContext };
    },
  };
};

/**
 * Decide a high-level source label for the retrieval trace. Useful in
 * logs and for the eventual admin UI; the planner doesn't read it.
 *
 * @param {{ chatContext: ChatContext, candidatesCount: number, resolvedCount: number }} args
 * @returns {string}
 */
const deriveSource = ({ chatContext, candidatesCount, resolvedCount }) => {
  const hasMemory = Object.keys(chatContext.confirmedMetricDefinitions).length > 0;
  if (hasMemory && resolvedCount > 0) return 'hybrid';
  if (hasMemory) return 'memory';
  if (resolvedCount > 0) return candidatesCount > 0 ? 'vector' : 'catalog';
  return 'none';
};

/**
 * Convenience factory that wires the default providers from env. The
 * `context.node.js` entry point uses this; tests inject custom deps
 * via `createContextLoader` directly.
 */
export const createDefaultContextLoader = async () => {
  const [chatMemory, semantic, vector] = await Promise.all([
    createChatMemoryProvider(),
    createSemanticProvider(),
    createVectorClient(),
  ]);
  return createContextLoader({ chatMemory, semantic, vector });
};
