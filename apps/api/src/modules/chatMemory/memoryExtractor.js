/**
 * Pure helper that turns a (request, plan, executionResult) triple
 * into the `Partial<ChatContext>` delta written back to chat memory.
 *
 * Storage rules baked in here (Phase 2D spec):
 *   - store the user's question (capped, deduped at the provider)
 *   - store `requiredMetrics` → `lastMetricRefs`
 *   - store `filters`          → `lastFilterRefs`
 *   - store `metricDefinitions` ONLY when `source === "chat_context"`
 *     (those are user-confirmed formulas; global formulas live in the
 *     semantic catalog and are re-fetched on demand)
 *   - optionally summarise the result (rowCount only — we never write
 *     raw rows or LLM-generated prose)
 *
 * Explicitly NOT stored:
 *   - SQL text (any form — SQL drafts, normalised SQL)
 *   - assumptions (those are speculative; only confirmed metric
 *     definitions get persisted)
 *   - raw LLM rationale
 *   - tenant credentials, host, port (these never reach this layer
 *     anyway)
 *
 * @typedef {import('../contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../contracts/queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('../contracts/executionResult.js').ExecutionResult} ExecutionResult
 * @typedef {import('../contracts/agentState.js').ChatContext} ChatContext
 *
 * @param {{ request: QueryRequest, plan: QueryPlan, result?: ExecutionResult|null }} args
 * @returns {Partial<ChatContext>}
 */
export const extractMemoryFromPlan = ({ request, plan, result }) => {
  /** @type {Partial<ChatContext>} */
  const delta = {};

  if (request && typeof request.question === 'string' && request.question.trim().length > 0) {
    delta.previousQuestions = [request.question];
  }

  if (plan && Array.isArray(plan.requiredMetrics) && plan.requiredMetrics.length > 0) {
    delta.lastMetricRefs = plan.requiredMetrics
      .filter((m) => typeof m === 'string' && m.length > 0)
      .slice();
  }

  if (plan && Array.isArray(plan.filters) && plan.filters.length > 0) {
    delta.lastFilterRefs = plan.filters
      .filter((f) => typeof f === 'string' && f.length > 0)
      .map((f) => ({ kind: 'plan_filter', text: f }));
  }

  // Only chat-confirmed formulas are persisted. Global-context
  // formulas live in the semantic catalog and would just shadow the
  // catalog if we wrote them into chat memory.
  if (plan && Array.isArray(plan.metricDefinitions) && plan.metricDefinitions.length > 0) {
    /** @type {Record<string, string>} */
    const confirmed = {};
    for (const md of plan.metricDefinitions) {
      if (md && md.source === 'chat_context' && typeof md.formula === 'string' && md.formula) {
        confirmed[md.name] = md.formula;
      }
    }
    if (Object.keys(confirmed).length > 0) {
      delta.confirmedMetricDefinitions = confirmed;
    }
  }

  if (result && result.ok && result.stats && typeof result.stats.rowCount === 'number') {
    // Tiny structural summary only — NEVER store rows or generated prose.
    delta.lastResultSummary = `rows=${result.stats.rowCount}; truncated=${result.stats.truncated ? 'true' : 'false'}`;
  }

  return delta;
};
