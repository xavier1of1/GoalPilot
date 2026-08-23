export abstract class AppError extends Error {
  public abstract readonly code: string;
  public abstract readonly httpStatus: number;
  public readonly safeDetails?: Readonly<Record<string, unknown>>;
}

export class ValidationAppError extends AppError {
  public readonly code = 'VALIDATION_ERROR';
  public readonly httpStatus = 400;

  public constructor(message = 'Check the highlighted information and try again.') {
    super(message);
  }
}

export class AuthenticationRequiredError extends AppError {
  public readonly code = 'AUTHENTICATION_REQUIRED';
  public readonly httpStatus = 401;

  public constructor(message = 'Sign in to continue.') {
    super(message);
  }
}

export class ResourceNotFoundError extends AppError {
  public readonly code = 'GOAL_NOT_FOUND';
  public readonly httpStatus = 404;

  public constructor(message = 'The requested goal was not found.') {
    super(message);
  }
}

export class ConflictAppError extends AppError {
  public readonly code = 'CONFLICT';
  public readonly httpStatus = 409;

  public constructor(message: string) {
    super(message);
  }
}

export class ForbiddenOperationError extends AppError {
  public readonly code = 'FORBIDDEN_OPERATION';
  public readonly httpStatus = 403;

  public constructor(message = 'This operation is not allowed.') {
    super(message);
  }
}
