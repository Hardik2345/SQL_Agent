import { assertContract, check } from '../../lib/runtimeValidators.js';
import { AGENT_STATUS } from '../../utils/constants.js';

/**
 * @typedef {import('./queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('./queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('./sqlDraft.js').SqlDraft} SqlDraft
 * @typedef {import('./validationResult.js').ValidationResult} ValidationResult
 * @typedef {import('./executionResult.js').ExecutionResult} ExecutionResult
 * @typedef {import('../tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 * @typedef {import('../schema/schema.types.js').SchemaContext} SchemaContext
 */

/**
 * Optional grounding context the planner consumes to decide whether
 * a question is answerable as-is or needs clarification. These are
 * placeholders only — the persistence layer that populates them
 * (per-brand metric catalog, recent-questions store) is intentionally
 * deferred.
 *
 * @typedef {Object} GlobalContext
 * @property {Record<string, { formula?: string, description?: string, synonyms?: string[] }>} [metrics]
 * @property {Record<string, string>} [glossary]
 * @property {Record<string, string>} [synonyms]
 *
 * @typedef {Object} ChatContext
 * @property {string[]}                       [previousQuestions]
 * @property {Record<string, string>}         [confirmedMetricDefinitions]
 * @property {Array<Record<string, unknown>>} [lastUsedFilters]
 * @property {string|null}                    [lastResultSummary]
 * @property {string[]}                       [lastMetricRefs]
 * @property {Array<Record<string, unknown>>} [lastFilterRefs]
 */

/**
 * Phase 2D: debug / observability surface produced by the context
 * loader. The planner does NOT consume this directly — the merged
 * grounding lives in `globalContext` and `chatContext`. The retrieval
 * trace is exposed for logs and (eventually) admin UIs.
 *
 * @typedef {Object} RetrievalContext
 * @property {Array<{ metricId: string, score: number }>} [vectorCandidates]
 * @property {string[]}                                   [resolvedMetricIds]
 * @property {string}                                     [source]            "memory|catalog|vector|hybrid|none"
 * @property {Record<string, unknown>}                    [debug]
 */

/**
 * @typedef {Object} CorrectionHistoryEntry
 * @property {number}                                 attempt        1-indexed attempt number.
 * @property {Array<Record<string, unknown>>}         issues         Failing V_* issues that triggered this correction.
 * @property {string}                                 previousSql    SQL the correction was asked to fix.
 * @property {string}                                 [correctedSql] Replacement SQL the correction produced.
 * @property {'mock'|'llm'}                           mode           Mode the correction node ran in.
 *
 * @typedef {Object} AgentState
 * @property {string}                   correlationId        Per-request correlation id.
 * @property {QueryRequest}             request              Original caller request.
 * @property {TenantExecutionContext}   tenant               Normalized tenant routing context.
 * @property {SchemaContext}            [schemaContext]      Tenant schema attached by load_schema node.
 * @property {GlobalContext}            [globalContext]      Brand-level metric catalog / glossary.
 * @property {ChatContext}              [chatContext]        Per-conversation hints / confirmations.
 * @property {RetrievalContext}         [retrievalContext]   Hybrid-retrieval debug trace (Phase 2D).
 * @property {QueryPlan}                [plan]               Plan produced by planner node.
 * @property {SqlDraft}                 [sqlDraft]           SQL draft produced by generator node.
 * @property {ValidationResult}         [validation]         Result from validator node.
 * @property {ExecutionResult}          [execution]          Result from executor node.
 * @property {number}                   [correctionAttempts] How many times the correction node has run for this request.
 * @property {CorrectionHistoryEntry[]} [correctionHistory]  Per-attempt audit trail; never contains credentials.
 * @property {(typeof AGENT_STATUS)[keyof typeof AGENT_STATUS]} status   Coarse status for observability.
 * @property {{ code: string, message: string }} [error]     Terminal error captured on the state.
 */

const tenantSchema = check.object({
  brandId: check.nonEmptyString(),
  database: check.nonEmptyString(),
  host: check.nonEmptyString(),
  port: check.number({ integer: true, min: 1, max: 65535 }),
  shardId: check.nonEmptyString({ required: false }),
  poolKey: check.nonEmptyString(),
  credentials: check.object(
    {
      user: check.nonEmptyString(),
      password: check.nonEmptyString(),
    },
    { required: true },
  ),
});

const schema = check.object({
  correlationId: check.nonEmptyString(),
  request: check.object({
    brandId: check.nonEmptyString(),
    question: check.nonEmptyString(),
    correlationId: check.nonEmptyString({ required: false }),
    context: check.record(() => [], { required: false }),
  }),
  tenant: tenantSchema,
  status: check.oneOf(Object.values(AGENT_STATUS)),
  schemaContext: check.object({}, { required: false }),
  globalContext: check.object({}, { required: false }),
  chatContext: check.object({}, { required: false }),
  retrievalContext: check.object({}, { required: false }),
  plan: check.object({}, { required: false }),
  sqlDraft: check.object({}, { required: false }),
  validation: check.object({}, { required: false }),
  execution: check.object({}, { required: false }),
  correctionAttempts: check.number({ required: false, integer: true, min: 0 }),
  correctionHistory: check.array(() => [], { required: false }),
  error: check.object(
    {
      code: check.nonEmptyString(),
      message: check.nonEmptyString(),
    },
    { required: false },
  ),
});

/**
 * @param {unknown} value
 * @returns {AgentState}
 */
export const assertAgentState = (value) =>
  assertContract('AgentState', schema, value);
