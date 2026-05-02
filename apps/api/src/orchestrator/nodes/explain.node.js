import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../../config/env.js';
import { getLlm } from '../../lib/llm.js';
import { buildExplanationContext } from '../../modules/explanation/explanationContext.js';
import { assertInsightExplanation } from '../../modules/explanation/explanation.types.js';
import { ContractError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {import('../../lib/llm.js').LlmClient} LlmClient
 * @typedef {import('../../modules/explanation/explanation.types.js').InsightExplanation} InsightExplanation
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'prompts',
  'explanation.prompt.md',
);

/** @type {string|null} */
let cachedSystemPrompt = null;

const loadSystemPrompt = async () => {
  if (cachedSystemPrompt && process.env.NODE_ENV !== 'development') {
    return cachedSystemPrompt;
  }
  cachedSystemPrompt = await fs.readFile(PROMPT_PATH, 'utf8');
  return cachedSystemPrompt;
};

/**
 * @param {number} rowCount
 * @returns {InsightExplanation}
 */
const mockExplanation = (rowCount) => ({
  type: 'table_result',
  headline: 'Query executed successfully',
  summary: `Returned ${rowCount} rows.`,
  keyPoints: [],
  caveats: [],
  suggestedVisualization: { type: 'table' },
  confidence: 1,
});

/**
 * @param {ReturnType<typeof buildExplanationContext>} ctx
 */
const buildUserMessage = (ctx) => [
  'Explanation context:',
  JSON.stringify(ctx, null, 2),
  '',
  'Return ONLY a JSON object matching the InsightExplanation contract.',
].join('\n');

/**
 * @param {{
 *   request: import('../../modules/contracts/queryRequest.js').QueryRequest,
 *   plan: import('../../modules/contracts/queryPlan.js').QueryPlan,
 *   execution: import('../../modules/contracts/executionResult.js').ExecutionResult,
 *   llm: LlmClient,
 *   correlationId?: string,
 * }} args
 */
const llmExplanation = async ({ request, plan, execution, llm, correlationId }) => {
  const systemPrompt = await loadSystemPrompt();
  const ctx = buildExplanationContext({ request, plan, execution });
  const userPrompt = buildUserMessage(ctx);

  let raw;
  try {
    raw = await llm.invokeJson([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
  } catch (err) {
    logger.warn(
      {
        event: 'node.explain.llm_error',
        correlationId,
        message: err instanceof Error ? err.message : String(err),
      },
      'explanation llm call failed',
    );
    throw new ContractError('LLM explanation returned non-JSON output', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('LLM explanation returned non-object JSON', {
      receivedType: Array.isArray(raw) ? 'array' : typeof raw,
    });
  }

  const candidate = /** @type {Record<string, unknown>} */ (raw);
  if (typeof candidate.headline !== 'string' || candidate.headline.trim() === '') {
    throw new ContractError('LLM explanation missing headline');
  }
  if (typeof candidate.summary !== 'string' || candidate.summary.trim() === '') {
    throw new ContractError('LLM explanation missing summary');
  }
  if (!Array.isArray(candidate.keyPoints)) {
    throw new ContractError('LLM explanation keyPoints must be an array');
  }

  return assertInsightExplanation(candidate);
};

/**
 * @param {{ mode?: 'mock'|'llm', llm?: LlmClient }} [options]
 */
export const createExplainNode = (options = {}) => {
  const mode = options.mode ?? env.explanation.mode;
  const explicitLlm = options.llm ?? null;

  /**
   * @param {import('../../modules/contracts/agentState.js').AgentState} state
   */
  return async (state) => {
    const { request, plan, execution, correlationId } = state;
    if (!request) throw new ContractError('explainNode requires state.request');
    if (!plan) throw new ContractError('explainNode requires state.plan');
    if (!execution) throw new ContractError('explainNode requires state.execution');

    logger.info(
      {
        event: 'node.explain.start',
        correlationId,
        mode,
        rowCount: execution.stats?.rowCount,
      },
      'explanation node started',
    );

    const explanation = mode === 'llm'
      ? await llmExplanation({
        request,
        plan,
        execution,
        llm: explicitLlm ?? getLlm('explanation'),
        correlationId,
      })
      : assertInsightExplanation(mockExplanation(execution.stats.rowCount));

    logger.info(
      {
        event: 'node.explain.ok',
        correlationId,
        mode,
        type: explanation.type,
      },
      'explanation node finished',
    );

    return { explanation };
  };
};

export const explainNode = createExplainNode();

export const __test = { buildUserMessage, loadSystemPrompt, mockExplanation };
