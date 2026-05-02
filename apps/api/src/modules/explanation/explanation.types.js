import { assertContract, check } from '../../lib/runtimeValidators.js';

/**
 * @typedef {Object} SuggestedVisualization
 * @property {"table"|"line"|"bar"|"metric"|"none"} type
 * @property {string} [x]
 * @property {string} [y]
 * @property {string} [series]
 *
 * @typedef {Object} InsightExplanation
 * @property {"text_insight"|"table_result"|"mixed"} type
 * @property {string} headline
 * @property {string} summary
 * @property {string[]} keyPoints
 * @property {string[]} caveats
 * @property {SuggestedVisualization} [suggestedVisualization]
 * @property {number} [confidence]
 */

const suggestedVisualizationSchema = check.object(
  {
    type: check.oneOf(['table', 'line', 'bar', 'metric', 'none']),
    x: check.string({ required: false, max: 200 }),
    y: check.string({ required: false, max: 200 }),
    series: check.string({ required: false, max: 200 }),
  },
  { required: false },
);

const explanationSchema = check.object({
  type: check.oneOf(['text_insight', 'table_result', 'mixed']),
  headline: check.nonEmptyString(),
  summary: check.nonEmptyString(),
  keyPoints: check.array(check.string({ max: 1000 })),
  caveats: check.array(check.string({ max: 1000 })),
  suggestedVisualization: suggestedVisualizationSchema,
  confidence: check.number({ required: false, min: 0, max: 1 }),
});

/**
 * @param {unknown} value
 * @returns {InsightExplanation}
 */
export const assertInsightExplanation = (value) =>
  assertContract('InsightExplanation', explanationSchema, value);
