import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_STATUS, SQL_DIALECT } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { ContractError } from '../../utils/errors.js';
import { assertSqlDraft } from '../../modules/contracts/sqlDraft.js';
import { getLlm } from '../../lib/llm.js';
import { buildSqlContext } from '../../modules/sql/sqlContext.js';

/**
 * @typedef {import('../../modules/contracts/sqlDraft.js').SqlDraft} SqlDraft
 * @typedef {import('../../modules/contracts/queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('../../modules/schema/schema.types.js').SchemaContext} SchemaContext
 * @typedef {import('../../lib/llm.js').LlmClient} LlmClient
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Repo-root-relative path to the SQL system prompt. The file is loaded
 * once per process and cached, mirroring the planner.
 *
 * From: apps/api/src/orchestrator/nodes/sql.node.js → 5 levels up = repo root.
 */
const PROMPT_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'prompts',
  'sql.prompt.md',
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
 * Mocked SQL draft used when SQL_MODE=mock (default).
 *
 * Targets `gross_summary` because that's a real table in the canonical
 * schema dump — the deterministic validation pipeline must accept this
 * SQL end-to-end. Plain SELECT, no aggregates, no GROUP BY.
 *
 * @param {QueryPlan} plan
 * @returns {SqlDraft}
 */
const mockSqlDraft = (plan) => {
  const table = plan.targetTables[0];
  return /** @type {SqlDraft} */ ({
    sql: `SELECT \`date\`, \`overall_sale\`, \`gross_sales\`
FROM \`${table}\`
ORDER BY \`date\` DESC
LIMIT 30`,
    dialect: SQL_DIALECT,
    tables: [table],
    rationale: '[mock sql-generator] deterministic draft (SQL_MODE=mock)',
  });
};

/**
 * Defence-in-depth scrubber for LLM output. The prompt forbids these
 * keys, but extra fields would otherwise pass through `assertSqlDraft`
 * (the runtime validator only checks declared keys), so we strip them
 * loudly here.
 *
 * @param {Record<string, unknown>} obj
 */
const stripForbiddenKeys = (obj) => {
  const FORBIDDEN = ['plan', 'queryPlan', 'sqlDraft', 'sql_draft'];
  for (const k of FORBIDDEN) {
    if (k in obj) {
      logger.warn(
        { event: 'node.sql.forbidden_key_stripped', key: k },
        `sql generator output contained forbidden key "${k}" — stripping`,
      );
      delete obj[k];
    }
  }
};

/**
 * Lightweight, intentionally minimal SQL normalisation:
 *   - trim whitespace,
 *   - drop ONE trailing `;` (the prompt says no semicolons, but we
 *     don't want a single stray one to fail the contract).
 *
 * Anything beyond this — DDL/DML detection, GROUP BY validation, etc.
 * — is the deterministic validation layer's job. Do not re-implement
 * safety here.
 *
 * @param {string} sql
 */
const sanitizeSql = (sql) => {
  let out = String(sql).trim();
  if (out.endsWith(';')) out = out.slice(0, -1).trimEnd();
  return out;
};

/**
 * Build the user message that feeds the LLM. The system prompt
 * (`prompts/sql.prompt.md`) is stable across requests; per-request
 * grounding goes here.
 *
 * @param {ReturnType<typeof buildSqlContext>} ctx
 */
const buildUserMessage = (ctx) => {
  const sections = [
    `Question: ${ctx.question}`,
    '',
    'Plan (authoritative — implement, do not re-plan):',
    JSON.stringify(ctx.plan, null, 2),
    '',
    'Tables (allowed for this request — full universe):',
    JSON.stringify(ctx.tables, null, 2),
    '',
    'AllowedColumns:',
    JSON.stringify(ctx.allowedColumns, null, 2),
    '',
    'Schema digest:',
    ctx.schemaDigest,
  ];

  if (ctx.metricDefinitions.length > 0) {
    sections.push(
      '',
      'Metric definitions to implement EXACTLY (do not substitute equivalents):',
      JSON.stringify(ctx.metricDefinitions, null, 2),
    );
  }

  if (ctx.assumptions.length > 0) {
    sections.push(
      '',
      'Planner assumptions (already baked in — do not second-guess):',
      ctx.assumptions.map((a, i) => `${i + 1}. ${a}`).join('\n'),
    );
  }

  sections.push(
    '',
    'Return ONLY a JSON object matching the SqlDraft contract.',
  );
  return sections.join('\n');
};

/**
 * Invoke the LLM and return a validated SqlDraft. Wraps non-JSON and
 * shape-violating responses in `ContractError` so the orchestrator
 * surfaces them as 4xx, not 500.
 *
 * @param {{
 *   plan: QueryPlan,
 *   request: import('../../modules/contracts/queryRequest.js').QueryRequest,
 *   schemaContext: SchemaContext,
 *   llm: LlmClient,
 *   correlationId?: string,
 * }} args
 * @returns {Promise<SqlDraft>}
 */
const llmSqlDraft = async ({ plan, request, schemaContext, llm, correlationId }) => {
  const systemPrompt = await loadSystemPrompt();
  const ctx = buildSqlContext({ request, plan, schemaContext });
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
        event: 'node.sql.llm_error',
        correlationId,
        message: err instanceof Error ? err.message : String(err),
      },
      'sql generator llm call failed',
    );
    throw new ContractError('LLM SQL generator returned non-JSON output', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('LLM SQL generator returned non-object JSON', {
      receivedType: Array.isArray(raw) ? 'array' : typeof raw,
    });
  }

  const candidate = /** @type {Record<string, unknown>} */ (raw);
  stripForbiddenKeys(candidate);

  // Sanitize SQL before contract validation so a stray trailing
  // semicolon (which the prompt forbids but models occasionally emit)
  // doesn't trip the downstream node-sql-parser at validation time.
  if (typeof candidate.sql === 'string') {
    candidate.sql = sanitizeSql(candidate.sql);
  }

  // assertSqlDraft enforces:
  //   - sql:     non-empty string
  //   - dialect: exactly 'mysql'
  //   - tables:  array of non-empty strings
  // Empty SQL (the prompt's failure mode) fails the non-empty check
  // and surfaces as a controlled ContractError — exactly what we want.
  return assertSqlDraft(candidate);
};

/**
 * Factory for the SQL generator node. Mirrors the planner's
 * `createPlanNode` for testability — fake LLM clients can be injected
 * without touching env or pulling in @langchain/openai.
 *
 * @param {{ mode?: 'mock'|'llm', llm?: LlmClient }} [options]
 */
export const createSqlNode = (options = {}) => {
  const mode = options.mode ?? env.sql.mode;
  const explicitLlm = options.llm ?? null;

  /**
   * @param {import('../../modules/contracts/agentState.js').AgentState} state
   */
  return async (state) => {
    const { request, plan, schemaContext, correlationId } = state;

    if (!request) {
      throw new ContractError('sqlNode requires state.request');
    }
    if (!plan) {
      throw new ContractError('sqlNode requires state.plan');
    }
    if (!schemaContext) {
      throw new ContractError('sqlNode requires state.schemaContext');
    }

    // Defensive: the conditional graph edge after the planner is
    // supposed to short-circuit non-ready plans to END
    // before this node runs. If we somehow got here anyway, fail
    // loudly rather than producing SQL the user never confirmed.
    if (plan.status !== 'ready') {
      throw new ContractError(
        `sqlNode reached with plan.status="${plan.status}" — graph routing failed`,
        { intent: plan.intent, requiredMetrics: plan.requiredMetrics },
      );
    }

    logger.info(
      {
        event: 'node.sql.start',
        correlationId,
        mode,
        questionLength: request.question.length,
        targetTables: plan.targetTables,
        metricCount: plan.metricDefinitions?.length ?? 0,
      },
      'sql generator node started',
    );

    /** @type {SqlDraft} */
    let draft;
    if (mode === 'llm') {
      draft = await llmSqlDraft({
        plan,
        request,
        schemaContext: /** @type {SchemaContext} */ (schemaContext),
        llm: explicitLlm ?? getLlm('sql'),
        correlationId,
      });
    } else {
      draft = assertSqlDraft(mockSqlDraft(plan));
    }

    logger.info(
      {
        event: 'node.sql.ok',
        correlationId,
        mode,
        tables: draft.tables,
        sqlLength: draft.sql.length,
      },
      'sql generator produced draft',
    );

    if (env.observability.logGeneratedSql && env.nodeEnv !== 'production') {
      logger.warn(
        {
          event: 'node.sql.generated_debug',
          correlationId,
          mode,
          tables: draft.tables,
          sql: draft.sql,
        },
        'DEV DEBUG: sql generator produced SQL',
      );
    }

    return { sqlDraft: draft, status: AGENT_STATUS.SQL_DRAFTED };
  };
};

/** Default SQL node bound to env-configured mode. Used by graph.js. */
export const sqlNode = createSqlNode();

/** Exposed for tests — lets unit tests inspect helpers in isolation. */
export const __test = { mockSqlDraft, sanitizeSql, buildUserMessage, loadSystemPrompt };
