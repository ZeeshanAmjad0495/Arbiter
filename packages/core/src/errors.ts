/**
 * Typed error taxonomy — modelled on the bot-request-runner convention of a
 * machine-classifiable error hierarchy with structured context. Every failure
 * in the guardrail pipeline maps to one of these codes so the governance/audit
 * layer can reason about it without string-matching messages.
 */
export type ErrorCode =
  | 'CONFIG'
  | 'SANITIZATION'
  | 'GROUNDING'
  | 'VALIDATION'
  | 'PROVIDER'
  | 'WRITEGATE'
  | 'REVIEW_REQUIRED'
  | 'NOT_FOUND'
  | 'INTERNAL';

export interface ArbiterErrorOptions {
  readonly cause?: unknown;
  /** True if a retry might succeed (network blip, rate limit) vs. a hard logic error. */
  readonly isTransient?: boolean;
  /** Structured, non-sensitive context for logs/audit. Never put raw PII here. */
  readonly context?: Readonly<Record<string, unknown>>;
}

export class ArbiterError extends Error {
  readonly code: ErrorCode;
  readonly isTransient: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, options: ArbiterErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.isTransient = options.isTransient ?? false;
    this.context = options.context ?? {};
  }
}

/** Sanitization refused to proceed (e.g. detected credentials, or default-deny on an uncertain field). */
export class SanitizationError extends ArbiterError {
  constructor(message: string, options: ArbiterErrorOptions = {}) {
    super('SANITIZATION', message, options);
  }
}

/** A generated artifact referenced something that does not exist in the grounded sources. */
export class GroundingError extends ArbiterError {
  constructor(message: string, options: ArbiterErrorOptions = {}) {
    super('GROUNDING', message, options);
  }
}

/** Structured-output validation failed (schema mismatch the provider could not repair). */
export class ValidationError extends ArbiterError {
  constructor(message: string, options: ArbiterErrorOptions = {}) {
    super('VALIDATION', message, options);
  }
}

/** An LLM provider call failed. */
export class ProviderError extends ArbiterError {
  constructor(message: string, options: ArbiterErrorOptions = {}) {
    super('PROVIDER', message, { isTransient: true, ...options });
  }
}

export class ConfigError extends ArbiterError {
  constructor(message: string, options: ArbiterErrorOptions = {}) {
    super('CONFIG', message, options);
  }
}

export function isArbiterError(e: unknown): e is ArbiterError {
  return e instanceof ArbiterError;
}
