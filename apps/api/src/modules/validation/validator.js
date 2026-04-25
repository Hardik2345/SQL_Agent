import { toSql } from '../../lib/parser.js';
import { logger } from '../../utils/logger.js';
import { assertValidationResult } from '../contracts/validationResult.js';
import { runCostRule } from './rules/cost.rule.js';
import { runSafetyRule } from './rules/safety.rule.js';
import { runSchemaRule } from './rules/schema.rule.js';
import { runSyntaxRule } from './rules/syntax.rule.js';
import { assertValidationInput } from './validation.types.js';

/**
 * @typedef {import('./validation.types.js').ValidationInput} ValidationInput
 * @typedef {import('../contracts/validationResult.js').ValidationResult} ValidationResult
 * @typedef {import('../contracts/validationResult.js').ValidationIssue} ValidationIssue
 */

const DEFAULT_POLICY = Object.freeze({
  maxJoins: 6,
  requireLimit: false,
});

/**
 * Run the full validation pipeline. The syntax rule runs first and short-
 * circuits downstream rules when it fails (they all require a valid AST).
 *
 * @param {ValidationInput} input
 * @returns {ValidationResult}
 */
export const validate = (input) => {
  const { sql, schema, policy = {} } = assertValidationInput(input);
  const effectivePolicy = { ...DEFAULT_POLICY, ...policy };

  /** @type {ValidationIssue[]} */
  const issues = [];

  const syntax = runSyntaxRule(sql);
  issues.push(...syntax.issues);

  if (!syntax.ast) {
    const result = {
      valid: issues.every((i) => i.severity !== 'error') && issues.length === 0,
      issues,
    };
    logger.warn(
      { event: 'validation.failed', stage: 'syntax', issueCount: issues.length },
      'validation halted at syntax rule',
    );
    return assertValidationResult(result);
  }

  issues.push(...runSafetyRule(syntax.ast, schema.database));
  issues.push(...runSchemaRule(sql, schema));
  issues.push(...runCostRule(syntax.ast, effectivePolicy));

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const valid = errorCount === 0;

  /** @type {ValidationResult} */
  const result = {
    valid,
    issues,
  };

  if (valid) {
    try {
      result.normalizedSql = toSql(syntax.ast);
    } catch (err) {
      logger.warn(
        { event: 'validation.normalize_failed', err },
        'failed to serialize normalized SQL',
      );
    }
  } else {
    logger.warn(
      {
        event: 'validation.failed',
        errorCount,
        codes: issues.filter((i) => i.severity === 'error').map((i) => i.code),
      },
      'validation failed',
    );
  }

  return assertValidationResult(result);
};
