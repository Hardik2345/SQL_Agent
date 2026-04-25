import { AGENT_STATUS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';
import { validate } from '../../modules/validation/validator.js';

/**
 * Validate node: runs the validation pipeline against the current SQL
 * draft using the SchemaContext that the load_schema node attached
 * earlier. If validation fails, the graph terminates with a
 * ValidationError — Phase 1 has no correction loop.
 *
 * Phase 2A change: the schema context is no longer hard-coded inside
 * this node. It must be present on `state.schemaContext` (populated by
 * the load_schema node which runs first in the graph). If absent, this
 * node fails with an internal error rather than silently using a stub
 * schema — that would be a serious safety regression.
 *
 * @param {import('../../modules/contracts/agentState.js').AgentState} state
 */
export const validateNode = async (state) => {
  const { sqlDraft, tenant, schemaContext, correlationId } = state;
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
        issues: result.issues,
      },
      'validation failed — halting orchestrator',
    );
    throw new ValidationError('SQL failed validation', {
      issues: result.issues,
    });
  }

  logger.info(
    { event: 'node.validate.ok', correlationId, brandId: tenant.brandId },
    'validation passed',
  );

  return { validation: result, status: AGENT_STATUS.VALIDATED };
};
