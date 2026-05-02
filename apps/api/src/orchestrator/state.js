import { AGENT_STATUS } from '../utils/constants.js';

/**
 * @typedef {import('../modules/contracts/agentState.js').AgentState} AgentState
 * @typedef {import('../modules/contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../modules/tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 */

/**
 * LangGraph state channel definition. Each channel is merged between nodes
 * using a `reducer`. Fields that are set exactly once (plan, sqlDraft, …)
 * use last-write-wins semantics.
 */
const lastWriteWins = (_prev, next) => next;
const keepIfDefined = (prev, next) => (next === undefined ? prev : next);

export const stateChannels = Object.freeze({
  correlationId: { value: lastWriteWins },
  request: { value: lastWriteWins },
  tenant: { value: lastWriteWins },
  schemaContext: { value: keepIfDefined },
  globalContext: { value: keepIfDefined },
  chatContext: { value: keepIfDefined },
  retrievalContext: { value: keepIfDefined },
  plan: { value: keepIfDefined },
  sqlDraft: { value: keepIfDefined },
  validation: { value: keepIfDefined },
  execution: { value: keepIfDefined },
  explanation: { value: keepIfDefined },
  // Phase 2C: bounded correction loop. The correction node manages
  // its own accumulation (reads previous, writes the merged value),
  // so last-write-wins is sufficient.
  correctionAttempts: { value: lastWriteWins, default: () => 0 },
  correctionHistory: { value: lastWriteWins, default: () => [] },
  status: { value: lastWriteWins, default: () => AGENT_STATUS.PENDING },
  error: { value: keepIfDefined },
});

/**
 * Build the initial AgentState for a request.
 * @param {{ correlationId: string, request: QueryRequest, tenant: TenantExecutionContext }} args
 * @returns {AgentState}
 */
export const initialState = ({ correlationId, request, tenant }) => ({
  correlationId,
  request,
  tenant,
  status: AGENT_STATUS.PENDING,
});
