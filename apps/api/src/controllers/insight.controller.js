import { runGraph } from '../orchestrator/graph.js';
import { assertQueryRequest } from '../modules/contracts/queryRequest.js';
import {
  AppError,
  ContractError,
  ValidationError,
  toAppError,
} from '../utils/errors.js';

/**
 * Translate a final orchestrator state into the response envelope.
 *
 * Phase 2B: when the planner short-circuits the graph with
 * `plan.status === "needs_clarification"`, we emit a dedicated
 * clarification response shape that the frontend can branch on. SQL
 * generation, validation, and execution did not run — `finalState`
 * carries no `execution` payload — and we must NOT pretend it did.
 *
 * Extracted from the request handler so it is unit-testable without
 * stubbing the orchestrator's ES module bindings.
 *
 * @param {import('../modules/contracts/agentState.js').AgentState} finalState
 * @param {string} correlationId
 * @param {{ info?: Function, warn?: Function, error?: Function }} [log]
 */
export const buildResponseFromState = (finalState, correlationId, log) => {
  if (finalState?.plan?.status === 'needs_clarification') {
    log?.info?.(
      {
        event: 'controller.query.clarification_required',
        intent: finalState.plan.intent,
        requiredMetrics: finalState.plan.requiredMetrics,
      },
      'planner asked for clarification — skipping SQL/validation/execution',
    );
    return {
      ok: true,
      correlationId,
      result: {
        ok: false,
        type: 'clarification_required',
        question: finalState.plan.clarificationQuestion,
        plan: {
          intent: finalState.plan.intent,
          requiredMetrics: finalState.plan.requiredMetrics,
        },
      },
    };
  }

  return {
    ok: true,
    correlationId,
    result: finalState.execution,
  };
};

/**
 * POST /insights/query handler.
 *
 * Assumptions: tenantContextMiddleware has already populated
 * `req.tenant`, `req.correlationId`, `req.brandId`, and `req.log`.
 *
 * Response contract: `{ ok, correlationId, result? | error? }` where
 * `result` is the ExecutionResult produced by the orchestrator.
 */
export const queryInsight = async (req, res) => {
  const { correlationId, tenant, log } = req;

  let request;
  try {
    request = assertQueryRequest({
      brandId: req.brandId,
      question: req.body?.question,
      correlationId,
      context: req.body?.context,
    });
  } catch (err) {
    const appErr = err instanceof ContractError ? err : toAppError(err);
    log.warn(
      { event: 'controller.query.bad_request', code: appErr.code, details: appErr.details },
      'invalid query request',
    );
    return res.status(appErr.status).json({
      ok: false,
      correlationId,
      error: { code: appErr.code, message: appErr.message, details: appErr.details },
    });
  }

  try {
    const finalState = await runGraph({ correlationId, request, tenant });
    const response = buildResponseFromState(finalState, correlationId, log);
    return res.status(200).json(response);
  } catch (err) {
    const appErr = err instanceof AppError ? err : toAppError(err);
    const status = appErr.status ?? 500;

    if (appErr instanceof ValidationError) {
      log.warn(
        { event: 'controller.query.validation_failed', code: appErr.code, details: appErr.details },
        'query halted at validation',
      );
    } else {
      log.error(
        { event: 'controller.query.failed', code: appErr.code, status, message: appErr.message },
        'query failed',
      );
    }

    return res.status(status).json({
      ok: false,
      correlationId,
      error: { code: appErr.code, message: appErr.message, details: appErr.details },
    });
  }
};
