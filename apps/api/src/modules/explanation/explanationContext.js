import { ContractError } from '../../utils/errors.js';

/**
 * @typedef {import('../contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../contracts/queryPlan.js').QueryPlan} QueryPlan
 * @typedef {import('../contracts/executionResult.js').ExecutionResult} ExecutionResult
 */

/**
 * Build the lightweight, read-only context used by the result explanation
 * layer. This intentionally excludes SQL, credentials, tenant routing, and
 * full datasets.
 *
 * @param {{ request: QueryRequest, plan: QueryPlan, execution: ExecutionResult }} args
 */
export const buildExplanationContext = ({ request, plan, execution }) => {
  if (!request?.question) throw new ContractError('buildExplanationContext requires request.question');
  if (!plan) throw new ContractError('buildExplanationContext requires plan');
  if (!execution?.stats) throw new ContractError('buildExplanationContext requires execution.stats');
  if (!Array.isArray(execution.rows)) throw new ContractError('buildExplanationContext requires execution.rows');
  if (!Array.isArray(execution.columns)) throw new ContractError('buildExplanationContext requires execution.columns');

  return {
    question: request.question,
    intent: plan.intent,
    metrics: plan.requiredMetrics ?? [],
    filters: plan.filters ?? [],
    rowCount: execution.stats.rowCount,
    truncated: execution.stats.truncated,
    sampleRows: execution.rows.slice(0, 5),
    columns: execution.columns,
  };
};
