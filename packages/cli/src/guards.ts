import { BrazeError, type Operation } from "brazecli-core"
import type { Settings } from "./settings.js"

/**
 * The two gates every write passes, in this order. One function so that the generated commands
 * of `CAT-6` cannot each grow their own slightly different version.
 *
 * A dry run is allowed through both: it builds the request and sends nothing, which is the tool
 * you want most when a profile is locked down.
 */
export const assertWriteAllowed = (settings: Settings, operation: Operation, invocation: string): void => {
  if (operation.access !== "write" || settings.dryRun) return

  // Read-only first, deliberately: `--confirm` guards against a mistyped command, this guards
  // against a correct command aimed at the wrong environment.
  if (settings.readOnly) {
    throw new BrazeError(
      "permission_error",
      `profile "${settings.profileName}" is marked read-only, so ${invocation} will not be sent. ` +
        "Use --dry-run to see what it would do, or remove readOnly from the profile in config.json.",
      { operation: operation.id },
    )
  }

  if (!settings.confirm) {
    throw new BrazeError(
      "confirmation_required",
      `${invocation} writes to Braze — re-run with --confirm, or with --dry-run to see what would be sent`,
      { operation: operation.id },
    )
  }
}
