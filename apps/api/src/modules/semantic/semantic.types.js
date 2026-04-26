import { ContractError } from '../../utils/errors.js';
import { asPlainObject, isNonEmptyString } from '../../utils/helpers.js';

/**
 * Phase 2D semantic catalog typedefs. The catalog is the **truth** for
 * metric definitions: anything reaching `state.globalContext.metrics`
 * comes from here (or from chat-confirmed overrides), never from the
 * vector candidate store. Vector hits are just IDs; we always
 * round-trip through Mongo before exposing the metric to the planner.
 *
 * @typedef {Object} SemanticMetric
 * @property {string}   metricId      Stable id; matches the planner's `requiredMetrics` entries.
 * @property {string}   tenantId      Brand id this metric applies to. ALL access is tenant-scoped.
 * @property {string}   [formula]     Authoritative formula text.
 * @property {string}   [description]
 * @property {string[]} [synonyms]
 * @property {string[]} [tables]      Tables the metric resolves against.
 * @property {string[]} [columns]     Columns the formula references.
 * @property {string}   [version]
 *
 * @typedef {Object} SemanticCatalog
 * @property {(metricIds: string[], tenantId: string) => Promise<SemanticMetric[]>} getMetricsByIds
 * @property {(term: string, tenantId: string) => Promise<SemanticMetric[]>}        getMetricsBySynonym
 */

const errs = (path, msg) => [`${path} ${msg}`];

const checkMetric = (value, path) => {
  const obj = asPlainObject(value);
  if (!obj) return errs(path, 'must be an object');
  const out = [];
  if (!isNonEmptyString(obj.metricId)) out.push(...errs(`${path}.metricId`, 'must be a non-empty string'));
  if (!isNonEmptyString(obj.tenantId)) out.push(...errs(`${path}.tenantId`, 'must be a non-empty string'));
  if (obj.formula !== undefined && typeof obj.formula !== 'string') out.push(...errs(`${path}.formula`, 'must be a string when present'));
  if (obj.description !== undefined && typeof obj.description !== 'string') out.push(...errs(`${path}.description`, 'must be a string when present'));
  if (obj.synonyms !== undefined && !Array.isArray(obj.synonyms)) out.push(...errs(`${path}.synonyms`, 'must be an array when present'));
  if (obj.tables !== undefined && !Array.isArray(obj.tables)) out.push(...errs(`${path}.tables`, 'must be an array when present'));
  if (obj.columns !== undefined && !Array.isArray(obj.columns)) out.push(...errs(`${path}.columns`, 'must be an array when present'));
  return out;
};

/**
 * @param {unknown} value
 * @returns {SemanticMetric}
 */
export const assertSemanticMetric = (value) => {
  const errors = checkMetric(value, 'SemanticMetric');
  if (errors.length) {
    throw new ContractError(
      `Contract violation in SemanticMetric: ${errors.length} error(s)`,
      { contract: 'SemanticMetric', errors },
    );
  }
  return /** @type {SemanticMetric} */ (value);
};
