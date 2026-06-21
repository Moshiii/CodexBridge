export class AppError extends Error {
  constructor(message, {
    kind = "system",
    code = "internal_error",
    statusCode = 500,
    expose = false,
    details = null,
  } = {}) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.code = code;
    this.statusCode = statusCode;
    this.expose = expose;
    this.details = details;
  }
}

export class UserInputError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      kind: "user",
      code: options.code || "invalid_request",
      statusCode: options.statusCode || 400,
      expose: true,
      details: options.details ?? null,
    });
    this.name = "UserInputError";
  }
}

export class NotFoundError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      kind: "user",
      code: options.code || "not_found",
      statusCode: 404,
      expose: true,
      details: options.details ?? null,
    });
    this.name = "NotFoundError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      kind: "external",
      code: options.code || "external_service_error",
      statusCode: options.statusCode || 502,
      expose: options.expose ?? false,
      details: options.details ?? null,
    });
    this.name = "ExternalServiceError";
  }
}

export class SystemError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      kind: "system",
      code: options.code || "system_error",
      statusCode: options.statusCode || 500,
      expose: options.expose ?? false,
      details: options.details ?? null,
    });
    this.name = "SystemError";
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function toPublicError(error) {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: error.expose ? error.message : "Internal server error",
        kind: error.kind,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  return {
    statusCode: 500,
    payload: {
      error: "Internal server error",
      kind: "system",
      code: "internal_error",
    },
  };
}
