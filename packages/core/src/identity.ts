/**
 * The fields Braze resolves a user by.
 *
 * Braze states the rule per object, not per request: "Each request object must include at least
 * one identifier", with `external_id`, `user_alias` and `braze_id` as primary and `email` and
 * `phone` as secondary — and "Only one primary identifier is allowed per request object—including
 * more than one causes that object to be rejected"
 * (https://www.braze.com/docs/api/endpoints/user_data/post_user_track, "Identifier resolution").
 *
 * The list lives here rather than inside a schema because the audit needs the same one: §35 lets
 * `records.csv` carry identifiers and nothing else, so something has to know which fields those
 * are, and two copies of that list is how one of them goes stale.
 */
export const IDENTIFIER_FIELDS = ["external_id", "user_alias", "braze_id", "email", "phone"] as const

export const PRIMARY_IDENTIFIER_FIELDS = ["external_id", "user_alias", "braze_id"] as const

export interface UserAlias {
  alias_name?: string
  alias_label?: string
}

export interface BrazeIdentifiers {
  external_id?: string
  braze_id?: string
  user_alias?: UserAlias
  email?: string
  phone?: string
}

/**
 * Copies the identifiers out of a record for the audit, and **nothing else** — §35 lets the audit
 * name the user and forbids it keeping arbitrary attributes. A record naming no user gives
 * `undefined`, which is what an audit row with no identifier honestly is.
 *
 * The alias is rebuilt from its two documented keys rather than copied whole: an alias object is
 * customer data like any other, and passing it through would carry arbitrary fields into the audit
 * through the one door meant to keep them out.
 */
export const identifiersOf = (value: unknown): BrazeIdentifiers | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined

  const record = value as Record<string, unknown>
  const found: BrazeIdentifiers = {}

  for (const field of ["external_id", "braze_id", "email", "phone"] as const) {
    const held = record[field]
    if (typeof held === "string" && held !== "") found[field] = held
  }

  const alias = record.user_alias
  if (typeof alias === "object" && alias !== null && !Array.isArray(alias)) {
    const { alias_name, alias_label } = alias as Record<string, unknown>
    const kept: UserAlias = {}
    if (typeof alias_name === "string") kept.alias_name = alias_name
    if (typeof alias_label === "string") kept.alias_label = alias_label
    if (Object.keys(kept).length > 0) found.user_alias = kept
  }

  return Object.keys(found).length > 0 ? found : undefined
}

/** Whether a record names a user at all — the "at least one identifier" half of Braze's rule. */
export const namesAUser = (record: Record<string, unknown>): boolean =>
  IDENTIFIER_FIELDS.some((field) => filled(record[field]))

/** How many primary identifiers a record carries. Braze rejects the object at two. */
export const primaryIdentifierCount = (record: Record<string, unknown>): number =>
  PRIMARY_IDENTIFIER_FIELDS.filter((field) => filled(record[field])).length

const filled = (value: unknown): boolean => {
  if (typeof value === "string") return value !== ""
  if (typeof value === "object" && value !== null) return Object.keys(value).length > 0
  return value !== undefined && value !== null
}
