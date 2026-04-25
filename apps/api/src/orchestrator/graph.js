import { END, START, StateGraph } from '@langchain/langgraph';
import { AGENT_STATUS, NODE } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { toAppError } from '../utils/errors.js';
import { initialState, stateChannels } from './state.js';
import { loadSchemaNode } from './nodes/schema.node.js';
import { planNode } from './nodes/plan.node.js';
import { sqlNode } from './nodes/sql.node.js';
import { validateNode } from './nodes/validate.node.js';
import { executeNode } from './nodes/execute.node.js';

/**
 * @typedef {import('../modules/contracts/agentState.js').AgentState} AgentState
 * @typedef {import('../modules/contracts/queryRequest.js').QueryRequest} QueryRequest
 * @typedef {import('../modules/tenant/tenant.types.js').TenantExecutionContext} TenantExecutionContext
 */

/**
 * Build and compile the Phase 2A LangGraph workflow:
 *   START -> load_schema -> plan -> generate_sql -> validate -> execute -> END
 *
 * `load_schema` runs first because plan, generate_sql, and validate all
 * depend on the SchemaContext attached to state.
 *
 * The graph is compiled once at module load. Nodes are deterministic and
 * pure-ish (they only touch external systems via injected modules), so the
 * compiled graph can be safely reused across requests.
 */
// LangGraph's generic typings are tuned for the newer Annotation.Root API;
// we intentionally use the legacy `{ channels }` form for clarity, and
// cast once here to keep downstream call sites typed-clean.
const StateGraphCtor = /** @type {new (args: any) => any} */ (/** @type {unknown} */ (StateGraph));
const builder = new StateGraphCtor({ channels: stateChannels });

builder.addNode(NODE.LOAD_SCHEMA, loadSchemaNode);
builder.addNode(NODE.PLAN, planNode);
builder.addNode(NODE.GENERATE_SQL, sqlNode);
builder.addNode(NODE.VALIDATE, validateNode);
builder.addNode(NODE.EXECUTE, executeNode);

/**
 * Conditional router that runs after the planner. When the plan
 * carries `status: "needs_clarification"` (Phase 2B), we stop the
 * graph immediately — there is no SQL to generate, validate, or
 * execute. The controller inspects `state.plan.status` and renders the
 * clarification response.
 *
 * Exposed for testing so the routing logic can be exercised without
 * compiling a graph.
 *
 * @param {{ plan?: { status?: string } }} state
 */
export const planRouter = (state) =>
  state?.plan?.status === 'needs_clarification' ? END : NODE.GENERATE_SQL;

builder.addEdge(START, NODE.LOAD_SCHEMA);
builder.addEdge(NODE.LOAD_SCHEMA, NODE.PLAN);
builder.addConditionalEdges(NODE.PLAN, planRouter, {
  [NODE.GENERATE_SQL]: NODE.GENERATE_SQL,
  [END]: END,
});
builder.addEdge(NODE.GENERATE_SQL, NODE.VALIDATE);
builder.addEdge(NODE.VALIDATE, NODE.EXECUTE);
builder.addEdge(NODE.EXECUTE, END);

export const compiledGraph = builder.compile();

/**
 * Run the orchestrator for a single request. Throws on terminal errors; the
 * caller is responsible for translating those errors to an HTTP response.
 *
 * @param {{ correlationId: string, request: QueryRequest, tenant: TenantExecutionContext }} args
 * @returns {Promise<AgentState>}
 */
export const runGraph = async ({ correlationId, request, tenant }) => {
  const seed = initialState({ correlationId, request, tenant });
  logger.info(
    {
      event: 'graph.start',
      correlationId,
      brandId: tenant.brandId,
    },
    'orchestrator invocation started',
  );

  try {
    const finalState = /** @type {AgentState} */ (await compiledGraph.invoke(seed));
    logger.info(
      {
        event: 'graph.ok',
        correlationId,
        status: finalState.status,
        brandId: tenant.brandId,
      },
      'orchestrator invocation finished',
    );
    return finalState;
  } catch (err) {
    const appErr = toAppError(err);
    logger.error(
      {
        event: 'graph.error',
        correlationId,
        brandId: tenant.brandId,
        code: appErr.code,
        status: appErr.status,
        message: appErr.message,
      },
      'orchestrator invocation failed',
    );
    throw appErr;
  }
};

export { AGENT_STATUS };
