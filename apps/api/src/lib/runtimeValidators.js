import { ContractError } from '../utils/errors.js';
import { asPlainObject, isNonEmptyString } from '../utils/helpers.js';

/**
 * A tiny, dependency-free runtime schema checker. It returns the input on
 * success, or throws a ContractError aggregating every failed assertion.
 *
 * The goal is NOT to replace a full validator like zod — it is to enforce
 * the shared contracts at module boundaries where contract drift is the
 * most expensive to debug.
 */

/** @typedef {(value: unknown, path: string) => string[]} Check */

export const check = {
  /** @returns {Check} */
  string: ({ required = true, min = 0, max = Infinity } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    if (typeof value !== 'string') return [`${path} must be a string`];
    if (value.length < min) return [`${path} must be at least ${min} chars`];
    if (value.length > max) return [`${path} must be at most ${max} chars`];
    return [];
  },
  /** @returns {Check} */
  nonEmptyString: ({ required = true } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    return isNonEmptyString(value) ? [] : [`${path} must be a non-empty string`];
  },
  /** @returns {Check} */
  number: ({ required = true, min = -Infinity, max = Infinity, integer = false } = {}) =>
    (value, path) => {
      if (value === undefined || value === null) {
        return required ? [`${path} is required`] : [];
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [`${path} must be a finite number`];
      }
      if (integer && !Number.isInteger(value)) return [`${path} must be an integer`];
      if (value < min) return [`${path} must be >= ${min}`];
      if (value > max) return [`${path} must be <= ${max}`];
      return [];
    },
  /** @returns {Check} */
  boolean: ({ required = true } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    return typeof value === 'boolean' ? [] : [`${path} must be a boolean`];
  },
  /** @returns {Check} */
  oneOf: (values, { required = true } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    return values.includes(value)
      ? []
      : [`${path} must be one of [${values.join(', ')}]`];
  },
  /** @returns {Check} */
  array: (itemCheck, { required = true, min = 0 } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (value.length < min) return [`${path} must contain at least ${min} items`];
    if (!itemCheck) return [];
    const errs = [];
    value.forEach((item, idx) => {
      errs.push(...itemCheck(item, `${path}[${idx}]`));
    });
    return errs;
  },
  /** @returns {Check} */
  object: (shape, { required = true } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    const obj = asPlainObject(value);
    if (!obj) return [`${path} must be an object`];
    const errs = [];
    for (const [key, childCheck] of Object.entries(shape)) {
      errs.push(...childCheck(obj[key], `${path}.${key}`));
    }
    return errs;
  },
  /** @returns {Check} */
  record: (valueCheck, { required = true } = {}) => (value, path) => {
    if (value === undefined || value === null) {
      return required ? [`${path} is required`] : [];
    }
    const obj = asPlainObject(value);
    if (!obj) return [`${path} must be an object`];
    const errs = [];
    for (const [key, v] of Object.entries(obj)) {
      errs.push(...valueCheck(v, `${path}.${key}`));
    }
    return errs;
  },
};

/**
 * Apply a schema check and throw ContractError with aggregated messages
 * when any assertion fails.
 * @template T
 * @param {string} contractName
 * @param {Check} checkFn
 * @param {unknown} value
 * @returns {T}
 */
export const assertContract = (contractName, checkFn, value) => {
  const errors = checkFn(value, contractName);
  if (errors.length) {
    throw new ContractError(
      `Contract violation in ${contractName}: ${errors.length} error(s)`,
      { contract: contractName, errors },
    );
  }
  return /** @type {T} */ (value);
};
