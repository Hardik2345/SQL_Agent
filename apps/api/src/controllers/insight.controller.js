import { runGraph } from '../orchestrator/graph.js';
import { assertQueryRequest } from '../modules/contracts/queryRequest.js';
import {
  AppError,
  ContractError,
  ValidationError,
  toAppError,
} from '../utils/errors.js';
import { createChatMemoryProvider } from '../modules/chatMemory/chatMemoryProvider.js';
import { extractMemoryFromPlan } from '../modules/chatMemory/memoryExtractor.js';
import { logger } from '../utils/logger.js';

/** @type {import('../modules/chatMemory/chatMemoryProvider.js').ChatMemoryProvider|null} */
let cachedMemoryProvider = null;
const getMemoryProvider = async () => {
  if (!cachedMemoryProvider) cachedMemoryProvider = await createChatMemoryProvider();
  return cachedMemoryProvider;
};

/**
 * Fire-and-forget memory write after successful execution.
 * Failures here MUST NOT affect the response — they're logged and
 * swallowed so a Redis hiccup never breaks an otherwise-successful
 * query.
 *
 * @param {import('../modules/contracts/agentState.js').AgentState} finalState
 */
const writeMemoryDelta = async (finalState) => {
  try {
    if (!finalState?.execution?.ok) return;
    if (!finalState.plan) return;
    const delta = extractMemoryFromPlan({
      request: finalState.request,
      plan: finalState.plan,
      result: finalState.execution,
    });
    if (Object.keys(delta).length === 0) return;
    const provider = await getMemoryProvider();
    const ctx = finalState.request?.context ?? {};
    await provider.updateChatContext({
      brandId: finalState.tenant.brandId,
      userId: typeof ctx.userId === 'string' ? ctx.userId : 'anonymous',
      conversationId: typeof ctx.conversationId === 'string' ? ctx.conversationId : 'default',
      memoryDelta: delta,
    });
  } catch (err) {
    logger.warn(
      {
        event: 'controller.memory_write.failed',
        correlationId: finalState?.correlationId,
        message: err instanceof Error ? err.message : String(err),
      },
      'post-execution memory write failed (swallowed)',
    );
  }
};

/**
 * Persist planner-produced chat memory updates. Unlike post-execution
 * memory writes, this is part of the user-visible operation: if it
 * fails, the request should fail rather than pretending the definition
 * was remembered.
 *
 * @param {import('../modules/contracts/agentState.js').AgentState} finalState
 */
const writePlannerMemoryUpdate = async (finalState) => {
  if (finalState?.plan?.status !== 'memory_update') return;
  const confirmedMetricDefinitions =
    finalState.plan.memoryUpdates?.confirmedMetricDefinitions ?? {};
  if (Object.keys(confirmedMetricDefinitions).length === 0) return;

  const provider = await getMemoryProvider();
  const ctx = finalState.request?.context ?? {};
  await provider.updateChatContext({
    brandId: finalState.tenant.brandId,
    userId: typeof ctx.userId === 'string' ? ctx.userId : 'anonymous',
    conversationId: typeof ctx.conversationId === 'string' ? ctx.conversationId : 'default',
    memoryDelta: {
      previousQuestions: [finalState.request.question],
      confirmedMetricDefinitions,
    },
  });
};

/**
 * Translate a final orchestrator state into the response envelope.
 *
 * Three branches:
 *   1. Phase 2B clarification — `plan.status === "needs_clarification"`.
 *      Emits `result: { ok: false, type: "clarification_required", … }`.
 *      No SQL/validate/execute ran.
 *   2. Phase 2C validation failure (after correction loop exhausted) —
 *      `validation.valid === false` AND no `execution`. Emits the
 *      `E_VALIDATION` error envelope with the failing issues plus
 *      `correctionAttempts` / `correctionHistory` in `details` for
 *      observability.
 *   3. Normal execution — emits `result: <ExecutionResult>`.
 *
 * Pure / unit-testable; HTTP status is decided separately by
 * `httpStatusForState` so the helper itself stays a body-only function.
 *
 * @param {import('../modules/contracts/agentState.js').AgentState} finalState
 * @param {string} correlationId
 * @param {{ info?: Function, warn?: Function, error?: Function }} [log]
 */
export const buildResponseFromState = (finalState, correlationId, log) => {
  if (finalState?.plan?.status === 'memory_update') {
    const confirmedMetricDefinitions =
      finalState.plan.memoryUpdates?.confirmedMetricDefinitions ?? {};
    const metricNames = Object.keys(confirmedMetricDefinitions);
    log?.info?.(
      {
        event: 'controller.query.memory_update',
        intent: finalState.plan.intent,
        metricNames,
      },
      'planner produced chat memory update — skipping SQL/validation/execution',
    );
    return {
      ok: true,
      correlationId,
      result: {
        ok: true,
        type: 'memory_ack',
        confirmedMetricDefinitions,
        message: metricNames.length === 1
          ? `Got it. I’ll use ${metricNames[0]} = ${confirmedMetricDefinitions[metricNames[0]]} in this conversation.`
          : `Got it. I’ll remember ${metricNames.length} metric definitions in this conversation.`,
      },
    };
  }

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

  // Phase 2C: validation failed and either correction was exhausted
  // or correction is disabled. We only end up here without an
  // `execution` because the validationRouter routed straight to END.
  if (
    finalState?.validation &&
    finalState.validation.valid === false &&
    !finalState.execution
  ) {
    log?.warn?.(
      {
        event: 'controller.query.validation_failed',
        code: 'E_VALIDATION',
        correctionAttempts: finalState.correctionAttempts ?? 0,
        issueCodes: finalState.validation.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.code),
      },
      'query halted at validation after correction loop exhausted',
    );
    return {
      ok: false,
      correlationId,
      error: {
        code: 'E_VALIDATION',
        message: 'SQL failed validation',
        details: {
          issues: finalState.validation.issues,
          correctionAttempts: finalState.correctionAttempts ?? 0,
          correctionHistory: finalState.correctionHistory ?? [],
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
 * HTTP status to pair with `buildResponseFromState`'s body. Kept
 * separate so the body builder stays pure / status-free.
 *
 * @param {import('../modules/contracts/agentState.js').AgentState} finalState
 */
export const httpStatusForState = (finalState) => {
  if (finalState?.plan?.status === 'memory_update') return 200;
  if (finalState?.plan?.status === 'needs_clarification') return 200;
  if (
    finalState?.validation &&
    finalState.validation.valid === false &&
    !finalState.execution
  ) {
    return 422;
  }
  return 200;
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
    if (finalState.plan?.status === 'memory_update') {
      await writePlannerMemoryUpdate(finalState);
    }
    const response = buildResponseFromState(finalState, correlationId, log);
    // Fire-and-forget. Memory write failure must not affect the
    // response status or body.
    writeMemoryDelta(finalState).catch(() => {});
    return res.status(httpStatusForState(finalState)).json(response);
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
