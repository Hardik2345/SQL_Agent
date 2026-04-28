import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_STATUS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { ContractError } from '../../utils/errors.js';
import { assertQueryPlan } from '../../modules/contracts/queryPlan.js';
import { getLlm } from '../../lib/llm.js';
import { buildPlannerContext } from '../../modules/planner/plannerContext.js';

/**
 * @typedef {import('../../modules/contracts/queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('../../modules/schema/schema.types.js').SchemaContext} SchemaContext
 * @typedef {import('../../modules/contracts/agentState.js').GlobalContext} GlobalContext
 * @typedef {import('../../modules/contracts/agentState.js').ChatContext} ChatContext
 * @typedef {import('../../lib/llm.js').LlmClient} LlmClient
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Repo-root-relative path to the planner system prompt. The file is
 * loaded once per process and cached.
 *
 * From: apps/api/src/orchestrator/nodes/plan.node.js → 5 levels up = repo root.
 */
const PROMPT_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'prompts',
  'planner.prompt.md',
);

/** @type {string|null} */
let cachedSystemPrompt = null;

const loadSystemPrompt = async () => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedSystemPrompt;
};

/**
 * Deterministic plan used in mock mode and as the Phase 2A baseline.
 * Targets `gross_summary` because that table exists in the canonical
 * schema dump.
 *
 * Includes the Phase 2B shape (status / clarificationQuestion /
 * assumptions / metricDefinitions) so the mock survives every
 * `assertQueryPlan` round-trip without relying on normalization
 * defaults.
 *
 * @returns {QueryPlan}
 */
const mockPlan = () =>
  /** @type {QueryPlan} */ ({
    intent: 'analytics_query',
    targetTables: ['gross_summary'],
    requiredMetrics: ['gross_sales'],
    resultShape: 'time_series',
    dimensions: ['date'],
    filters: [],
    timeGrain: 'day',
    notes: '[mock planner] deterministic plan (PLANNER_MODE=mock)',
    status: 'ready',
    clarificationQuestion: null,
    assumptions: [],
    metricDefinitions: [],
  });

/**
 * Strip any keys the planner is forbidden from producing. The prompt
 * tells the model not to emit `sql`, but the runtime still scrubs in
 * case the model misbehaves — defence in depth, especially since
 * extra fields would otherwise pass through `assertQueryPlan` (the
 * runtime validator only checks declared keys).
 *
 * @param {Record<string, unknown>} obj
 */
const stripForbiddenKeys = (obj) => {
  const FORBIDDEN = ['sql', 'query', 'sqlDraft', 'rawSql'];
  for (const k of FORBIDDEN) {
    if (k in obj) {
      logger.warn(
        { event: 'node.plan.forbidden_key_stripped', key: k },
        `planner output contained forbidden key "${k}" — stripping`,
      );
      delete obj[k];
    }
  }
};

/**
 * Build the user message that grounds the planner with question +
 * schema digest + (optional) global/chat context. We deliberately
 * serialize structured fields as JSON inside the user message instead
 * of mixing them into the system prompt, so the LLM sees the same
 * stable system prompt across every request.
 *
 * @param {ReturnType<typeof buildPlannerContext>} ctx
 */
const buildUserMessage = (ctx) => {
  const sections = [`Question: ${ctx.question}`];

  if (ctx.schemaDigest) {
    sections.push('', 'Schema (table: col(type), ... -- grain/responsibility/use_for/avoid):', ctx.schemaDigest);
  }

  // Only include the contextual blocks when they have content. The
  // planner prompt instructs the model to treat absent blocks as
  // "no grounding available — clarify rather than guess".
  const knownMetricsList = Object.values(ctx.knownMetrics);
  if (knownMetricsList.length > 0) {
    sections.push(
      '',
      'Known metric definitions (use these as authoritative; never invent formulas):',
      JSON.stringify(knownMetricsList, null, 2),
    );
  }

  if (Object.keys(ctx.glossary).length > 0) {
    sections.push(
      '',
      'Glossary / synonyms:',
      JSON.stringify(ctx.glossary, null, 2),
    );
  }

  if (Object.keys(ctx.confirmedDefinitions).length > 0) {
    sections.push(
      '',
      'Confirmed metric definitions from this conversation:',
      JSON.stringify(ctx.confirmedDefinitions, null, 2),
    );
  }

  if (ctx.previousQuestions.length > 0) {
    sections.push(
      '',
      'Recent questions in this conversation (for continuity hints only):',
      ctx.previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
    );
  }

  if (ctx.pendingClarification) {
    sections.push(
      '',
      'Pending clarification (the previous response was needs_clarification):',
      `Original question: ${ctx.pendingClarification.originalQuestion}`,
      `Agent asked: ${ctx.pendingClarification.clarificationQuestion}`,
      `User answered: ${ctx.question}`,
      '',
      'Treat the user answer as the response to the agent question above.',
      'Reconstruct the full analytics intent by combining the original question with the clarification answer, then plan accordingly.',
    );
  }

  sections.push(
    '',
    'Return ONLY a JSON object matching the QueryPlan contract.',
  );
  return sections.join('\n');
};

/**
 * Invoke the LLM and return a QueryPlan. Wraps non-JSON errors and
 * contract violations in `ContractError` so the orchestrator surfaces
 * them as 400 / 422 to callers, not 500.
 *
 * @param {{
 *   plannerCtx: ReturnType<typeof buildPlannerContext>,
 *   llm: LlmClient,
 *   correlationId?: string,
 * }} args
 * @returns {Promise<QueryPlan>}
 */
const llmPlan = async ({ plannerCtx, llm, correlationId }) => {
  const systemPrompt = await loadSystemPrompt();
  const userPrompt = buildUserMessage(plannerCtx);

  let raw;
  try {
    raw = await llm.invokeJson([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
  } catch (err) {
    logger.warn(
      {
        event: 'node.plan.llm_error',
        correlationId,
        message: err instanceof Error ? err.message : String(err),
      },
      'planner llm call failed',
    );
    throw new ContractError('LLM planner returned non-JSON output', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('LLM planner returned non-object JSON', {
      receivedType: Array.isArray(raw) ? 'array' : typeof raw,
    });
  }

  const candidate = /** @type {Record<string, unknown>} */ (raw);
  stripForbiddenKeys(candidate);

  // assertQueryPlan throws ContractError on shape violations, which is
  // the controlled error the spec requires. It also normalizes missing
  // newer fields so older / minimal responses still validate.
  return assertQueryPlan(candidate);
};

/**
 * Map the QueryPlan's `status` to the AgentState orchestration status.
 * Using a dedicated `clarification_required` orchestration status (vs
 * just `planned`) makes it observable in logs and drives the graph's
 * conditional edge.
 *
 * @param {QueryPlan} plan
 */
const orchestrationStatusFor = (plan) =>
  plan.status === 'needs_clarification'
    ? AGENT_STATUS.CLARIFICATION_REQUIRED
    : plan.status === 'memory_update'
      ? AGENT_STATUS.MEMORY_UPDATE_REQUIRED
    : AGENT_STATUS.PLANNED;

/**
 * Factory for the planner node. Defaults read from env, but tests can
 * inject any combination of `mode` and a fake `llm` client without
 * touching env or pulling in @langchain/openai.
 *
 * @param {{ mode?: 'mock'|'llm', llm?: LlmClient }} [options]
 */
export const createPlanNode = (options = {}) => {
  const mode = options.mode ?? env.planner.mode;
  const explicitLlm = options.llm ?? null;

  /**
   * @param {import('../../modules/contracts/agentState.js').AgentState} state
   */
  return async (state) => {
    const { request, schemaContext, globalContext, chatContext, correlationId } = state;
    if (!request) {
      throw new Error('planNode requires state.request');
    }
    if (mode === 'llm' && !schemaContext) {
      throw new Error(
        'planNode in llm mode requires state.schemaContext (load_schema must run first)',
      );
    }

    logger.info(
      {
        event: 'node.plan.start',
        correlationId,
        mode,
        questionLength: request.question.length,
        hasGlobalContext: Boolean(globalContext),
        hasChatContext: Boolean(chatContext),
      },
      'planner node started',
    );

    /** @type {QueryPlan} */
    let plan;
    if (mode === 'llm') {
      const plannerCtx = buildPlannerContext({
        request,
        schemaContext: /** @type {SchemaContext} */ (schemaContext),
        globalContext,
        chatContext,
      });
      plan = await llmPlan({
        plannerCtx,
        llm: explicitLlm ?? getLlm('planner'),
        correlationId,
      });
    } else {
      plan = assertQueryPlan(mockPlan());
    }

    const orchStatus = orchestrationStatusFor(plan);

    logger.info(
      {
        event: 'node.plan.ok',
        correlationId,
        mode,
        intent: plan.intent,
        planStatus: plan.status,
        orchStatus,
        tables: plan.targetTables,
        metrics: plan.requiredMetrics,
        clarificationQuestion: plan.clarificationQuestion,
      },
      plan.status === 'needs_clarification'
        ? 'planner asked for clarification'
        : plan.status === 'memory_update'
          ? 'planner produced memory update'
        : 'planner produced ready plan',
    );

    return { plan, status: orchStatus };
  };
};

/** Default planner node bound to env-configured mode. Used by graph.js. */
export const planNode = createPlanNode();

/** Exposed for testing — lets unit tests inspect helper functions. */
export const __test = { mockPlan, loadSystemPrompt, buildUserMessage };
