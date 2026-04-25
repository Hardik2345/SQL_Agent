/**
 * Base class for all known application errors. Carries a stable `code`
 * for programmatic handling and an HTTP-ish `status` for the API layer.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, cause?: unknown, details?: Record<string, unknown> }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code ?? 'E_APP';
    this.status = options.status ?? 500;
    this.details = options.details ?? {};
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

export class ContractError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_CONTRACT', status: 400, details });
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_VALIDATION', status: 422, details });
  }
}

export class TenantRouterError extends AppError {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.code ?? 'E_TENANT_ROUTER',
      status: options.status ?? 502,
      details: options.details,
      cause: options.cause,
    });
  }
}

export class TenantNotFoundError extends TenantRouterError {
  constructor(brandId) {
    super(`Tenant not found for brand_id=${brandId}`, {
      code: 'E_TENANT_NOT_FOUND',
      status: 404,
      details: { brandId },
    });
  }
}

export class TenantSuspendedError extends TenantRouterError {
  constructor(brandId) {
    super(`Tenant suspended for brand_id=${brandId}`, {
      code: 'E_TENANT_SUSPENDED',
      status: 403,
      details: { brandId },
    });
  }
}

export class GatewayAuthError extends AppError {
  constructor(message, details) {
    super(message, { code: 'E_GATEWAY_AUTH', status: 401, details });
  }
}

export class TenantUnavailableError extends TenantRouterError {
  constructor(brandId) {
    super(`Tenant router unavailable for brand_id=${brandId}`, {
      code: 'E_TENANT_UNAVAILABLE',
      status: 503,
      details: { brandId },
    });
  }
}

export class ExecutionError extends AppError {
  constructor(message, details, cause) {
    super(message, { code: 'E_EXECUTION', status: 500, details, cause });
  }
}

export class QueryTimeoutError extends ExecutionError {
  constructor(timeoutMs) {
    super('Query timed out', { timeoutMs });
    this.code = 'E_QUERY_TIMEOUT';
    this.status = 504;
  }
}

export class RowLimitExceededError extends ExecutionError {
  constructor(maxRows) {
    super('Query exceeded maximum row limit', { maxRows });
    this.code = 'E_ROW_LIMIT';
    this.status = 413;
  }
}

/**
 * Normalize any thrown value into an AppError.
 * @param {unknown} err
 */
export const toAppError = (err) => {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError(err.message, { cause: err });
  }
  return new AppError(String(err));
};
