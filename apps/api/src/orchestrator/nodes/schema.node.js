import { AGENT_STATUS } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';
import { getSchemaContext } from '../../modules/schema/schemaProvider.js';

/**
 * Schema-loading node. Runs first in the Phase 2A graph, before plan
 * and validate, because both downstream nodes depend on the SchemaContext.
 *
 * Side-effect-free w.r.t. tenant data:
 *   - never calls an LLM,
 *   - never calls tenant-router,
 *   - never executes SQL,
 *   - only reads the checked-in schema dump (and the cache).
 *
 * Tenant context is attached for observability (and to populate
 * `database` on the resulting SchemaContext) but is NOT used to choose
 * what schema to load — every tenant currently uses the same dump.
 *
 * @param {import('../../modules/contracts/agentState.js').AgentState} state
 */
export const loadSchemaNode = async (state) => {
  const { tenant, correlationId } = state;
  if (!tenant) {
    throw new Error('loadSchemaNode requires state.tenant');
  }

  logger.info(
    {
      event: 'node.load_schema.start',
      correlationId,
      brandId: tenant.brandId,
    },
    'load schema node started',
  );

  const schemaContext = await getSchemaContext({ tenant, correlationId });

  logger.info(
    {
      event: 'node.load_schema.ok',
      correlationId,
      brandId: tenant.brandId,
      tableCount: schemaContext.allowedTables.length,
    },
    'schema context attached to state',
  );

  return { schemaContext, status: AGENT_STATUS.SCHEMA_LOADED };
};
