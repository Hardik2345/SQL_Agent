/**
 * Shared primitive typedefs used across the service.
 */

/** @typedef {string} BrandId — externally-owned brand identifier. */
/** @typedef {string} TenantId — tenant-router-owned tenant identifier. */
/** @typedef {string} CorrelationId — per-request correlation UUID. */

/**
 * @typedef {Object} ApiError
 * @property {string} code
 * @property {string} message
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {Object} ApiEnvelope
 * @property {boolean} ok
 * @property {string}  correlationId
 * @property {unknown} [result]
 * @property {ApiError} [error]
 */

export {};
