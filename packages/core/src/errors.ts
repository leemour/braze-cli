/**
 * Every failure the CLI and any other consumer can see. The list is closed on purpose:
 * an agent branches on `code`, and a new code is a contract change.
 */
export const errorCodes = [
  "validation_error",
  "configuration_error",
  "authentication_error",
  "permission_error",
  "not_found",
  "confirmation_required",
  "rate_limited",
  "timeout",
  "network_error",
  "provider_error",
  "provider_unavailable",
  "invalid_response",
  "outcome_unknown",
  "cancelled",
] as const

export type ErrorCode = (typeof errorCodes)[number]

export interface BrazeErrorDetails {
  readonly httpStatus?: number
  readonly retryable?: boolean
  readonly attempts?: number
  readonly requestId?: string
  readonly runId?: string
  readonly retryAfterMs?: number
  readonly operation?: string
}

export class BrazeError extends Error {
  readonly code: ErrorCode
  readonly details: BrazeErrorDetails

  constructor(code: ErrorCode, message: string, details: BrazeErrorDetails = {}) {
    super(message)
    this.name = "BrazeError"
    this.code = code
    this.details = details
  }
}
