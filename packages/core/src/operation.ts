import type { HttpMethod } from "./request.js"

export type Access = "read" | "write"

/**
 * Whether an attempt may be repeated. Braze documents no general idempotency key, so a write
 * defaults to `never`: repeating it can duplicate the effect, and no header tells Braze to
 * deduplicate. `idempotent` is for the specific endpoints Braze documents as safe, if any ever are.
 */
export type RetryPolicy = "read-safe" | "idempotent" | "never"

export type PaginationStyle = "none" | "page" | "offset" | "cursor"

export interface Operation {
  /** Stable across catalog regenerations: `users.track`, `campaigns.details`. */
  id: string
  command: readonly string[]
  method: HttpMethod
  path: string
  access: Access
  retryPolicy: RetryPolicy
  /** The Braze permission an API key needs, as Braze names it. */
  permission?: string
  pagination?: PaginationStyle
  /**
   * How many items one page holds, when Braze documents it. Without this a caller cannot tell a
   * full page from the last one, and `/campaigns/list` returning 100 rows looks identical to
   * "that is all of them".
   */
  pageSize?: number
  /** Braze's per-request limits, by field: `{ attributes: 75, events: 75, purchases: 75 }`. */
  batch?: Readonly<Record<string, number>>
  description?: string
  documentationUrl?: string
  /**
   * Placeholders in `path`, in the order they appear: `["catalog_name", "item_id"]`. Named rather
   * than counted, because this is what an agent has to be told in order to call the operation at
   * all — `braze commands --json` has nothing else to offer it.
   */
  pathParameters?: readonly string[]
  /** Query keys the collection documents. Not exhaustive: Postman examples are not a schema. */
  queryParameters?: readonly QueryParameter[]
  /** The Postman request this was generated from, for matching an operation across regenerations. */
  sourceId?: string
}

export interface QueryParameter {
  name: string
  description?: string
  example?: string
}

export interface OperationDefinition extends Omit<Operation, "retryPolicy"> {
  retryPolicy?: RetryPolicy
}

export const defineOperation = (definition: OperationDefinition): Operation => ({
  ...definition,
  retryPolicy: definition.retryPolicy ?? (definition.access === "read" ? "read-safe" : "never"),
})

/**
 * What `braze api` sends. §14 of the brief: the method decides, even though some Braze reads are
 * POSTs — a typed catalog operation is where that gets corrected, one endpoint at a time.
 */
export const rawOperation = (method: HttpMethod, path: string): Operation => {
  const read = method === "GET" || method === "HEAD"
  return {
    id: `api.${method.toLowerCase()}`,
    command: ["api", method, path],
    method,
    path,
    access: read ? "read" : "write",
    retryPolicy: read ? "read-safe" : "never",
  }
}

/**
 * Branches on the policy alone. An operation with `access: "write"` and `retryPolicy: "read-safe"`
 * is a catalog bug for `CAT-4`'s override validation to reject, not a case to handle here — two
 * sources of truth for "may this be repeated" is how one of them ends up wrong.
 */
export const mayRetry = (operation: Operation): boolean => operation.retryPolicy !== "never"
