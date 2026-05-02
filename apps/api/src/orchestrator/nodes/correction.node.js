import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_STATUS, SQL_DIALECT } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { ContractError } from '../../utils/errors.js';
import { assertSqlDraft } from '../../modules/contracts/sqlDraft.js';
import { getLlm } from '../../lib/llm.js';
import { buildCorrectionContext } from '../../modules/correction/correctionContext.js';

/**
 * @typedef {import('../../modules/contracts/sqlDraft.js').SqlDraft} SqlDraft
 * @typedef {import('../../modules/contracts/queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('../../modules/contracts/validationResult.js').ValidationResult} ValidationResult
 * @typedef {import('../../modules/contracts/agentState.js').CorrectionHistoryEntry} CorrectionHistoryEntry
 * @typedef {import('../../lib/llm.js').LlmClient} LlmClient
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'prompts',
  'correction.prompt.md',
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
 * Mock correction returns the failing SQL unchanged. This is the
 * conservative, deterministic, CI-safe choice: the next validate run
 * will fail with the same issues and the loop exits at
 * MAX_CORRECTION_ATTEMPTS without fabricating "intelligence" the mock
 * doesn't have. Tests that exercise the routing don't need fake
 * fixes — they need predictable behaviour.
 *
 * @param {SqlDraft} previous
 * @returns {SqlDraft}
 */
const mockCorrection = (previous) =>
  /** @type {SqlDraft} */ ({
    sql: previous.sql,
    dialect: SQL_DIALECT,
    tables: previous.tables.slice(),
    rationale: '[mock correction] unchanged (CORRECTION_MODE=mock)',
  });

/**
 * Defence-in-depth scrubber for LLM output. The prompt forbids these
 * keys; strip loudly if the model misbehaves.
 *
 * @param {Record<string, unknown>} obj
 */
const stripForbiddenKeys = (obj) => {
  const FORBIDDEN = ['plan', 'queryPlan', 'sqlDraft', 'sql_draft'];
  for (const k of FORBIDDEN) {
    if (k in obj) {
      logger.warn(
        { event: 'node.correct.forbidden_key_stripped', key: k },
        `correction output contained forbidden key "${k}" — stripping`,
      );
      delete obj[k];
    }
  }
};

/**
 * Same minimal sanitisation as the SQL node: trim + strip ≤ 1
 * trailing semicolon. Anything beyond that belongs to the validation
 * layer. We deliberately do NOT regex-check DDL/DML or schema
 * fidelity here — re-running validate is the contract.
 *
 * @param {string} sql
 */
const sanitizeSql = (sql) => {
  let out = String(sql).trim();
  if (out.endsWith(';')) out = out.slice(0, -1).trimEnd();
  return out;
};

/**
 * Build the user message for the correction LLM. System prompt is
 * stable across attempts; per-attempt grounding goes here.
 *
 * @param {ReturnType<typeof buildCorrectionContext>} ctx
 */
const buildUserMessage = (ctx) => {
  const sections = [
    `Question: ${ctx.question}`,
    '',
    'Plan (authoritative — do not re-plan):',
    JSON.stringify(ctx.plan, null, 2),
    '',
    `FailedSQL (attempt ${ctx.attempt} of ${ctx.maxAttempts}):`,
    ctx.failedSql,
    '',
    'ValidationIssues (V_* codes — fix every error-severity entry):',
    JSON.stringify(ctx.validationIssues, null, 2),
    '',
    'Tables (allowed for this request):',
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
      'Metric definitions (implement formulas LITERALLY — do not substitute):',
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
 * Invoke the LLM and return a corrected SqlDraft.
 *
 * @param {{
 *   request: import('../../modules/contracts/queryRequest.js').QueryRequest,
 *   plan: QueryPlan,
 *   schemaContext: import('../../modules/schema/schema.types.js').SchemaContext,
 *   sqlDraft: SqlDraft,
 *   validation: ValidationResult,
 *   correctionAttempts: number,
 *   maxAttempts: number,
 *   llm: LlmClient,
 *   correlationId?: string,
 * }} args
 * @returns {Promise<SqlDraft>}
 */
const llmCorrection = async ({
  request,
  plan,
  schemaContext,
  sqlDraft,
  validation,
  correctionAttempts,
  maxAttempts,
  llm,
  correlationId,
}) => {
  const systemPrompt = await loadSystemPrompt();
  const ctx = buildCorrectionContext({
    request,
    plan,
    schemaContext,
    sqlDraft,
    validation,
    correctionAttempts,
    maxAttempts,
  });
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
        event: 'node.correct.llm_error',
        correlationId,
        attempt: ctx.attempt,
        message: err instanceof Error ? err.message : String(err),
      },
      'correction llm call failed',
    );
    throw new ContractError('LLM correction returned non-JSON output', {
      reason: err instanceof Error ? err.message : String(err),
      attempt: ctx.attempt,
    });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError('LLM correction returned non-object JSON', {
      receivedType: Array.isArray(raw) ? 'array' : typeof raw,
    });
  }

  const candidate = /** @type {Record<string, unknown>} */ (raw);
  stripForbiddenKeys(candidate);

  if (typeof candidate.sql === 'string') {
    candidate.sql = sanitizeSql(candidate.sql);
  }

  // Empty `sql` (the prompt's "unfixable" failure mode) trips the
  // contract's nonEmptyString check and surfaces as ContractError.
  return assertSqlDraft(candidate);
};

/**
 * Factory for the correction node. Mirrors planner / SQL factories
 * for testability — fake LLM clients can be injected without touching
 * env or pulling in @langchain/openai.
 *
 * @param {{ mode?: 'mock'|'llm', llm?: LlmClient }} [options]
 */
export const createCorrectionNode = (options = {}) => {
  const mode = options.mode ?? env.correction.mode;
  const explicitLlm = options.llm ?? null;

  /**
   * @param {import('../../modules/contracts/agentState.js').AgentState} state
   */
  return async (state) => {
    const { request, plan, schemaContext, sqlDraft, validation, correlationId } = state;

    if (!request) throw new ContractError('correctionNode requires state.request');
    if (!plan) throw new ContractError('correctionNode requires state.plan');
    if (!schemaContext) {
      throw new ContractError('correctionNode requires state.schemaContext');
    }
    if (!sqlDraft) throw new ContractError('correctionNode requires state.sqlDraft');
    if (!validation) {
      throw new ContractError('correctionNode requires state.validation');
    }
    if (validation.valid) {
      throw new ContractError(
        'correctionNode reached with valid validation — graph routing failed',
      );
    }
    if (!Array.isArray(validation.issues) || validation.issues.length === 0) {
      throw new ContractError(
        'correctionNode requires validation.issues to be a non-empty array',
      );
    }
    if (plan.status !== 'ready') {
      throw new ContractError(
        `correctionNode reached with plan.status="${plan.status}" — graph routing failed`,
        { intent: plan.intent },
      );
    }

    const previousAttempts = state.correctionAttempts ?? 0;
    const nextAttempt = previousAttempts + 1;
    const maxAttempts = env.correction.maxAttempts;

    logger.info(
      {
        event: 'node.correct.start',
        correlationId,
        mode,
        attempt: nextAttempt,
        maxAttempts,
        issueCodes: validation.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.code),
      },
      'correction node started',
    );

    /** @type {SqlDraft} */
    let correctedDraft;
    if (mode === 'llm') {
      correctedDraft = await llmCorrection({
        request,
        plan,
        schemaContext,
        sqlDraft,
        validation,
        correctionAttempts: previousAttempts,
        maxAttempts,
        llm: explicitLlm ?? getLlm('correction'),
        correlationId,
      });
    } else {
      correctedDraft = assertSqlDraft(mockCorrection(sqlDraft));
    }

    /** @type {CorrectionHistoryEntry} */
    const entry = {
      attempt: nextAttempt,
      issues: validation.issues.map((i) => ({
        code: i.code,
        message: i.message,
        severity: i.severity,
        meta: i.meta ?? {},
      })),
      previousSql: sqlDraft.sql,
      correctedSql: correctedDraft.sql,
      mode,
    };

    const previousHistory = Array.isArray(state.correctionHistory)
      ? state.correctionHistory
      : [];
    const correctionHistory = [...previousHistory, entry];

    logger.info(
      {
        event: 'node.correct.ok',
        correlationId,
        mode,
        attempt: nextAttempt,
        maxAttempts,
        sqlLength: correctedDraft.sql.length,
        tables: correctedDraft.tables,
      },
      'correction node produced replacement draft',
    );

    if (env.observability.logGeneratedSql && env.nodeEnv !== 'production') {
      logger.warn(
        {
          event: 'node.correct.generated_debug',
          correlationId,
          mode,
          attempt: nextAttempt,
          previousSql: sqlDraft.sql,
          correctedSql: correctedDraft.sql,
        },
        'DEV DEBUG: correction node produced SQL',
      );
    }

    return {
      sqlDraft: correctedDraft,
      correctionAttempts: nextAttempt,
      correctionHistory,
      status: AGENT_STATUS.CORRECTING,
    };
  };
};

/** Default correction node bound to env-configured mode. Used by graph.js. */
export const correctionNode = createCorrectionNode();

/** Exposed for tests. */
export const __test = { mockCorrection, sanitizeSql, buildUserMessage, loadSystemPrompt };
