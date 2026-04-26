import { AGENT_STATUS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { validate } from '../../modules/validation/validator.js';

/**
 * Validate node: runs the validation pipeline against the current SQL
 * draft using the SchemaContext that the load_schema node attached
 * earlier.
 *
 * Phase 2C change: this node no longer throws when validation fails.
 * Failure is a normal state transition that the conditional edge
 * `validationRouter` (in graph.js) routes to either the correction
 * node (if attempts remain) or END (if exhausted). After END, the
 * controller's `buildResponseFromState` renders the failure envelope
 * with the existing `E_VALIDATION` code. Throwing here would bypass
 * the correction loop entirely.
 *
 * Pre-conditions still throw (these are programmer errors, not user
 * errors): missing `sqlDraft` and missing `schemaContext`.
 *
 * @param {import('../../modules/contracts/agentState.js').AgentState} state
 */
export const validateNode = async (state) => {
  const { sqlDraft, tenant, schemaContext, correlationId, correctionAttempts } = state;
  if (!sqlDraft) {
    throw new Error('validateNode requires an sqlDraft');
  }
  if (!schemaContext) {
    throw new Error(
      'validateNode requires state.schemaContext (load_schema node must run first)',
    );
  }

  const result = validate({
    sql: sqlDraft.sql,
    schema: schemaContext,
  });

  if (!result.valid) {
    logger.warn(
      {
        event: 'node.validate.failed',
        correlationId,
        brandId: tenant.brandId,
        correctionAttempts: correctionAttempts ?? 0,
        issueCodes: result.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.code),
      },
      'validation failed — router will decide between correction and END',
    );
    // Status stays "validated" semantically (we DID run validation);
    // the router decides the next hop based on `validation.valid`.
    return { validation: result, status: AGENT_STATUS.VALIDATED };
  }

  logger.info(
    { event: 'node.validate.ok', correlationId, brandId: tenant.brandId },
    'validation passed',
  );

  return { validation: result, status: AGENT_STATUS.VALIDATED };
};
