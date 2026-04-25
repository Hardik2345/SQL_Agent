import { assertContract, check } from '../../lib/runtimeValidators.js';
import { asPlainObject, isNonEmptyString } from '../../utils/helpers.js';

/**
 * @typedef {'global_context'|'chat_context'|'planner_assumption'} MetricSource
 *
 * @typedef {Object} MetricDefinition
 * @property {string}        name          Metric identifier referenced by the planner.
 * @property {string}        [formula]     Optional formula text (e.g., "cancelled_orders / total_orders").
 * @property {string}        [description] Optional natural-language description.
 * @property {MetricSource}  source        Where the formula came from. `planner_assumption` is only
 *                                         allowed when explicitly grounded in provided context.
 *
 * @typedef {Object} QueryPlan
 * @property {string}              intent                    High-level intent classification.
 * @property {string[]}            targetTables              Tables the planner intends to query.
 *                                                            May be empty when status="needs_clarification".
 * @property {string[]}            requiredMetrics           Metrics or aggregates the answer requires.
 * @property {string[]}            [filters]                 Logical filter hints (non-SQL).
 * @property {string}              [timeGrain]               Optional time grain (day/week/month/…).
 * @property {string}              [notes]                   Free-form planner notes carried downstream.
 * @property {'ready'|'needs_clarification'} status          Whether downstream nodes may proceed.
 * @property {string|null}         clarificationQuestion     Set iff status="needs_clarification".
 * @property {string[]}            assumptions               Assumptions the planner relied on,
 *                                                            grounded in the provided context.
 * @property {MetricDefinition[]}  metricDefinitions         Resolved metric definitions used by the plan.
 */

const READY = 'ready';
const NEEDS_CLARIFICATION = 'needs_clarification';

const stringOrNullCheck = (value, path) => {
  if (value === null) return [];
  if (typeof value === 'string') return [];
  return [`${path} must be a string or null`];
};

const metricDefinitionSchema = check.object({
  name: check.nonEmptyString(),
  formula: check.string({ required: false, max: 4000 }),
  description: check.string({ required: false, max: 4000 }),
  source: check.oneOf(['global_context', 'chat_context', 'planner_assumption']),
});

const schema = check.object({
  intent: check.nonEmptyString(),
  // Allow empty targetTables when status === 'needs_clarification'. The
  // ready-vs-clarification cross-validation runs after the shape check
  // below.
  targetTables: check.array(check.nonEmptyString()),
  requiredMetrics: check.array(check.nonEmptyString()),
  filters: check.array(check.nonEmptyString(), { required: false }),
  timeGrain: check.nonEmptyString({ required: false }),
  notes: check.string({ required: false, max: 4000 }),
  status: check.oneOf([READY, NEEDS_CLARIFICATION]),
  clarificationQuestion: stringOrNullCheck,
  assumptions: check.array(check.string({ max: 1000 })),
  metricDefinitions: check.array(metricDefinitionSchema),
});

/**
 * Normalize a raw plan candidate into the canonical QueryPlan shape.
 *
 * Fills missing newer fields with their defaults so older callers (the
 * mock planner, legacy LLM responses, hand-authored test fixtures) keep
 * passing through `assertQueryPlan` without modification.
 *
 *  - status                 → "ready"
 *  - clarificationQuestion  → null
 *  - assumptions            → []
 *  - metricDefinitions      → []
 *
 * Existing fields are NEVER renamed or removed by this function. If the
 * input is not an object, it is returned untouched and the contract
 * validator below produces the appropriate error.
 *
 * @param {unknown} raw
 */
const normalizePlan = (raw) => {
  const obj = asPlainObject(raw);
  if (!obj) return raw;
  const out = { ...obj };
  if (out.status === undefined) out.status = READY;
  if (out.clarificationQuestion === undefined) out.clarificationQuestion = null;
  if (out.assumptions === undefined) out.assumptions = [];
  if (out.metricDefinitions === undefined) out.metricDefinitions = [];
  return out;
};

/**
 * Validate ready/clarification cross-rules that can't be expressed in
 * the field-level schema cleanly.
 *
 * @param {Record<string, unknown>} plan
 * @returns {string[]}
 */
const crossValidate = (plan) => {
  const errs = [];
  const status = plan.status;
  if (status === NEEDS_CLARIFICATION) {
    if (!isNonEmptyString(plan.clarificationQuestion)) {
      errs.push(
        'QueryPlan.clarificationQuestion must be a non-empty string when status="needs_clarification"',
      );
    }
  } else if (status === READY) {
    if (!Array.isArray(plan.targetTables) || plan.targetTables.length === 0) {
      errs.push(
        'QueryPlan.targetTables must contain at least one entry when status="ready"',
      );
    }
  }
  return errs;
};

/**
 * @param {unknown} value
 * @returns {QueryPlan}
 */
export const assertQueryPlan = (value) => {
  const normalized = normalizePlan(value);
  const validated = assertContract('QueryPlan', schema, normalized);

  const crossErrors = crossValidate(/** @type {Record<string, unknown>} */ (validated));
  if (crossErrors.length) {
    // Defer to ContractError construction by rerouting through assertContract
    // — keeps the error shape consistent with other contract failures.
    assertContract(
      'QueryPlan',
      () => crossErrors,
      validated,
    );
  }
  return /** @type {QueryPlan} */ (validated);
};
