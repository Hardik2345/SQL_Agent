/**
 * Planner context builder.
 *
 * Compresses everything the planner needs into a single JSON-serializable
 * object. The result is what we hand to the LLM in the user message —
 * keep it small (token budget) and **never** include credentials, tenant
 * routing details, or anything that wouldn't be safe in a prompt log.
 *
 * The builder is deliberately a pure function with no I/O so tests can
 * assert exactly what reaches the prompt.
 *
 * @typedef {import('../contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../schema/schema.types.js').SchemaContext} SchemaContext
 * @typedef {import('../contracts/agentState.js').GlobalContext} GlobalContext
 * @typedef {import('../contracts/agentState.js').ChatContext} ChatContext
 *
 * @typedef {Object} CompactSchemaTable
 * @property {string} name
 * @property {string} columns          A "col1(type), col2(type), …" string.
 *
 * @typedef {Object} PlannerContext
 * @property {string}                                  question
 * @property {string}                                  schemaDigest          Newline-joined `table: cols` lines.
 * @property {Record<string, KnownMetric>}             knownMetrics          Merged from globalContext + chatContext.
 * @property {Record<string, string>}                  glossary              Brand glossary terms.
 * @property {string[]}                                previousQuestions     Up to N most-recent prior questions.
 * @property {Record<string, string>}                  confirmedDefinitions  User-confirmed metric formulas.
 * @property {{ originalQuestion: string, clarificationQuestion: string }|null} pendingClarification  Set when the previous response was needs_clarification.
 *
 * @typedef {Object} KnownMetric
 * @property {string}                       name
 * @property {string}                       [formula]
 * @property {string}                       [description]
 * @property {string[]}                     [synonyms]
 * @property {'global_context'|'chat_context'} source
 */

import { formatTableMetadata, getPlannerVisibleTables } from '../schema/tableMetadata.js';

const MAX_PREVIOUS_QUESTIONS = 5;

/**
 * Compact "table: col(type), …" digest. Same format the LLM has been
 * trained-against in the prompt; centralized here so the planner and
 * the (future) SQL generator agree on shape.
 *
 * @param {SchemaContext} schemaContext
 */
const buildSchemaDigest = (schemaContext) => {
  const lines = [];
  for (const tableName of getPlannerVisibleTables(schemaContext)) {
    const t = schemaContext.tables[tableName];
    if (!t) continue;
    const colTokens = Object.values(t.columns).map(
      (c) => `${c.name}(${c.type})`,
    );
    const metadata = formatTableMetadata(tableName);
    lines.push(
      metadata
        ? `${tableName}: ${colTokens.join(', ')} -- ${metadata}`
        : `${tableName}: ${colTokens.join(', ')}`,
    );
  }
  return lines.join('\n');
};

/**
 * Merge metric definitions from `globalContext.metrics` and
 * `chatContext.confirmedMetricDefinitions`. Chat-confirmed entries win
 * on conflict because they represent an explicit user decision that
 * supersedes the brand default.
 *
 * @param {GlobalContext|undefined} globalContext
 * @param {ChatContext|undefined} chatContext
 * @returns {Record<string, KnownMetric>}
 */
const mergeKnownMetrics = (globalContext, chatContext) => {
  /** @type {Record<string, KnownMetric>} */
  const out = {};

  const gMetrics = globalContext?.metrics ?? {};
  for (const [name, def] of Object.entries(gMetrics)) {
    out[name] = {
      name,
      formula: def?.formula,
      description: def?.description,
      synonyms: Array.isArray(def?.synonyms) ? def.synonyms.slice() : undefined,
      source: 'global_context',
    };
  }

  const confirmed = chatContext?.confirmedMetricDefinitions ?? {};
  for (const [name, formula] of Object.entries(confirmed)) {
    out[name] = {
      name,
      formula: typeof formula === 'string' ? formula : undefined,
      description: out[name]?.description,
      synonyms: out[name]?.synonyms,
      source: 'chat_context',
    };
  }

  return out;
};

/**
 * Build the compact planner context. Pure / deterministic / test-safe.
 *
 * Inputs are read defensively — any of `schemaContext`, `globalContext`,
 * `chatContext` may be missing, and the builder still produces a
 * usable (but emptier) context.
 *
 * @param {{
 *   request: QueryRequest,
 *   schemaContext?: SchemaContext,
 *   globalContext?: GlobalContext,
 *   chatContext?: ChatContext,
 * }} args
 * @returns {PlannerContext}
 */
export const buildPlannerContext = ({
  request,
  schemaContext,
  globalContext,
  chatContext,
}) => {
  if (!request || typeof request.question !== 'string') {
    throw new Error('buildPlannerContext requires request.question');
  }

  const schemaDigest = schemaContext ? buildSchemaDigest(schemaContext) : '';
  const knownMetrics = mergeKnownMetrics(globalContext, chatContext);

  const glossary = { ...(globalContext?.glossary ?? {}) };
  // Synonyms are conceptually distinct from glossary, but for the
  // planner's purposes they're equivalent grounding signals — fold
  // them in so the LLM sees both without doubling prompt structure.
  for (const [k, v] of Object.entries(globalContext?.synonyms ?? {})) {
    if (typeof v === 'string' && !(k in glossary)) glossary[k] = v;
  }

  const previousQuestions = Array.isArray(chatContext?.previousQuestions)
    ? chatContext.previousQuestions.slice(-MAX_PREVIOUS_QUESTIONS)
    : [];

  const confirmedDefinitions = { ...(chatContext?.confirmedMetricDefinitions ?? {}) };

  const pc = chatContext?.pendingClarification ?? null;
  const pendingClarification =
    pc && typeof pc.originalQuestion === 'string' && typeof pc.clarificationQuestion === 'string'
      ? { originalQuestion: pc.originalQuestion, clarificationQuestion: pc.clarificationQuestion }
      : null;

  return {
    question: request.question,
    schemaDigest,
    knownMetrics,
    glossary,
    previousQuestions,
    confirmedDefinitions,
    pendingClarification,
  };
};

/** Exposed for direct testing. */
export const __test = { buildSchemaDigest, mergeKnownMetrics };
