export class KeyfrontError extends Error {
  public readonly code: string;
  public readonly traceId?: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(
    code: string,
    message: string,
    traceId?: string,
    statusCode: number = 500,
    details?: any
  ) {
    super(message);
    this.name = 'KeyfrontError';
    this.code = code;
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.details = details;

    // Ensure stack trace points to actual error location
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KeyfrontError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      traceId: this.traceId,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack,
    };
  }

  toApiResponse() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        traceId: this.traceId,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Predefined error types
export class AuthenticationError extends KeyfrontError {
  constructor(message: string, traceId?: string, details?: any) {
    super('AUTHENTICATION_FAILED', message, traceId, 401, details);
  }
}

export class AuthorizationError extends KeyfrontError {
  constructor(message: string, traceId?: string, details?: any) {
    super('AUTHORIZATION_FAILED', message, traceId, 403, details);
  }
}

export class ValidationError extends KeyfrontError {
  constructor(message: string, traceId?: string, details?: any) {
    super('VALIDATION_FAILED', message, traceId, 400, details);
  }
}

export class RateLimitError extends KeyfrontError {
  constructor(message: string, traceId?: string, details?: any) {
    super('RATE_LIMIT_EXCEEDED', message, traceId, 429, details);
  }
}

export class ServiceUnavailableError extends KeyfrontError {
  constructor(message: string, traceId?: string, details?: any) {
    super('SERVICE_UNAVAILABLE', message, traceId, 503, details);
  }
}

export class SessionExpiredError extends KeyfrontError {
  constructor(message: string = 'Session has expired', traceId?: string) {
    super('SESSION_EXPIRED', message, traceId, 401);
  }
}

export class TenantAccessError extends KeyfrontError {
  constructor(message: string = 'Access denied to this tenant', traceId?: string, details?: any) {
    super('TENANT_ACCESS_DENIED', message, traceId, 403, details);
  }
}

// Error handler utility
export function handleError(error: unknown, traceId?: string): KeyfrontError {
  if (error instanceof KeyfrontError) {
    return error;
  }

  if (error instanceof Error) {
    return new KeyfrontError(
      'INTERNAL_ERROR',
      error.message,
      traceId,
      500,
      { originalError: error.name }
    );
  }

  return new KeyfrontError(
    'UNKNOWN_ERROR',
    'An unknown error occurred',
    traceId,
    500,
    { originalError: String(error) }
  );
}

// Error response builder
export function buildErrorResponse(error: unknown, traceId?: string) {
  const keyfrontError = handleError(error, traceId);
  
  // Log error for debugging
  console.error('Error occurred:', {
    code: keyfrontError.code,
    message: keyfrontError.message,
    traceId: keyfrontError.traceId,
    stack: keyfrontError.stack,
  });

  return {
    response: keyfrontError.toApiResponse(),
    status: keyfrontError.statusCode,
    headers: {
      'x-keyfront-trace-id': keyfrontError.traceId || traceId || 'unknown',
      'x-keyfront-error-code': keyfrontError.code,
    },
  };
}