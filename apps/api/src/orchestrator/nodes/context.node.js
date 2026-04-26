import { AGENT_STATUS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { createDefaultContextLoader } from '../../modules/context/contextLoader.js';

/**
 * Phase 2D `load_context` node.
 *
 * Runs AFTER `load_schema` and BEFORE `planner`. Pulls chat memory
 * from Redis (or in-memory fallback), runs hybrid retrieval over the
 * semantic catalog + vector store, and attaches the resulting
 * `chatContext`, `globalContext`, and `retrievalContext` to state.
 *
 * Side-effects:
 *   - reads from Redis (if configured)
 *   - reads from MongoDB (if configured)
 *   - reads from Qdrant (if configured)
 *   - never calls an LLM (the planner does)
 *   - never calls tenant-router or the tenant DB
 *   - never mutates `state.schemaContext`
 *
 * Tenant scoping is enforced by all three providers — every read
 * filters on `tenant.brandId`.
 *
 * The default loader is built once per process and cached (lazy);
 * tests inject a custom loader via `createContextNode({ loader })`.
 *
 * @typedef {import('../../modules/context/contextLoader.js').ContextLoader} ContextLoader
 */

/** @type {ContextLoader|null} */
let cachedDefaultLoader = null;

const getDefaultLoader = async () => {
  if (!cachedDefaultLoader) {
    cachedDefaultLoader = await createDefaultContextLoader();
  }
  return cachedDefaultLoader;
};

/**
 * Factory mirrors planner / SQL / correction nodes. The `loader`
 * option is the seam tests use to inject mock chat memory + semantic
 * + vector without touching env or any external services.
 *
 * @param {{ loader?: ContextLoader }} [options]
 */
export const createContextNode = (options = {}) => {
  const explicitLoader = options.loader ?? null;

  /**
   * @param {import('../../modules/contracts/agentState.js').AgentState} state
   */
  return async (state) => {
    const { request, tenant, correlationId } = state;
    if (!request) throw new Error('loadContextNode requires state.request');
    if (!tenant) throw new Error('loadContextNode requires state.tenant');

    logger.info(
      {
        event: 'node.load_context.start',
        correlationId,
        brandId: tenant.brandId,
        questionLength: request.question.length,
      },
      'load_context node started',
    );

    const loader = explicitLoader ?? (await getDefaultLoader());

    const result = await loader.load({
      request,
      tenant,
      // request.context can carry caller-supplied conversation hints
      // (passed through middleware). Ignored for now beyond the two
      // stable fields below; future phases can widen.
      conversationId: typeof request.context?.conversationId === 'string'
        ? request.context.conversationId
        : undefined,
      userId: typeof request.context?.userId === 'string'
        ? request.context.userId
        : undefined,
      correlationId,
    });

    logger.info(
      {
        event: 'node.load_context.ok',
        correlationId,
        brandId: tenant.brandId,
        resolvedMetricIds: result.retrievalContext.resolvedMetricIds,
        source: result.retrievalContext.source,
      },
      'context attached to state',
    );

    return {
      chatContext: result.chatContext,
      globalContext: result.globalContext,
      retrievalContext: result.retrievalContext,
      status: AGENT_STATUS.CONTEXT_LOADED,
    };
  };
};

/** Default node bound to env-configured providers. Used by graph.js. */
export const loadContextNode = createContextNode();

/** Test-only: reset the cached default loader. */
export const __test = {
  resetDefaultLoader: () => {
    cachedDefaultLoader = null;
  },
};
