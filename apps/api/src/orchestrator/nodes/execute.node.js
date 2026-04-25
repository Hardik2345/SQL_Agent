import { AGENT_STATUS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { execute } from '../../modules/execution/executor.js';

/**
 * Execute node. Must not be called unless the preceding validate node
 * marked the SQL draft valid — the graph enforces the ordering.
 *
 * @param {import('../../modules/contracts/agentState.js').AgentState} state
 */
export const executeNode = async (state) => {
  const { sqlDraft, validation, tenant, correlationId } = state;
  if (!sqlDraft) throw new Error('executeNode requires an sqlDraft');
  if (!validation || !validation.valid) {
    throw new Error('executeNode requires a passing validation result');
  }

  logger.info(
    { event: 'node.execute.start', correlationId, brandId: tenant.brandId },
    'execute node started',
  );

  const result = await execute({
    tenant,
    sql: validation.normalizedSql ?? sqlDraft.sql,
    correlationId,
  });

  logger.info(
    {
      event: 'node.execute.ok',
      correlationId,
      brandId: tenant.brandId,
      rowCount: result.stats.rowCount,
      elapsedMs: result.stats.elapsedMs,
    },
    'execute node finished',
  );

  return { execution: result, status: AGENT_STATUS.EXECUTED };
};
