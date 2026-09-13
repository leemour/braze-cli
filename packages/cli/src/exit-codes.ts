import type { ErrorCode } from "brazecli-core"

/**
 * One mapping, so a script can branch on `$?` without parsing text. Defined here rather than at
 * each command site: numbers invented per command are how two of them end up disagreeing.
 *
 * 130 for a cancellation is the shell's convention for SIGINT.
 */
const EXIT_CODES: Record<ErrorCode, number> = {
  validation_error: 2,
  configuration_error: 3,
  authentication_error: 4,
  permission_error: 5,
  not_found: 6,
  confirmation_required: 7,
  rate_limited: 8,
  timeout: 9,
  network_error: 10,
  provider_error: 11,
  provider_unavailable: 12,
  invalid_response: 13,
  outcome_unknown: 14,
  cancelled: 130,
}

export const exitCodeFor = (code: ErrorCode): number => EXIT_CODES[code]

export const GENERIC_FAILURE = 1
