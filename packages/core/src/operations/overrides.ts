import type { Access, PaginationStyle, RetryPolicy } from "../operation.js"

/**
 * What a handwritten correction may change. Not `id`, `method` or `path`: those identify the
 * operation being corrected, and an override that could move them would silently become an
 * override of something else the next time Braze reorganises the collection.
 */
export interface OperationOverride {
  command?: readonly string[]
  access?: Access
  retryPolicy?: RetryPolicy
  permission?: string
  pagination?: PaginationStyle
  pageSize?: number
  batch?: Readonly<Record<string, number>>
  description?: string
  documentationUrl?: string
  /** Why the correction exists. Read by whoever wonders whether it is still needed. */
  reason: string
}

/**
 * Corrections to the generated catalog, keyed by `Operation.id`.
 *
 * Keyed by id rather than by path as §10 sketches, because a path is not unique — `/catalogs`
 * carries both a GET and a POST — so a path-keyed override would silently hit both.
 *
 * Everything here is a fact about Braze that the Postman collection does not carry. If something
 * can be derived from the collection, derive it in the generator instead: an override is a line
 * someone has to re-check every time Braze changes.
 */
export const overrides: Readonly<Record<string, OperationOverride>> = {
  "users.export.ids.create": {
    access: "read",
    retryPolicy: "read-safe",
    permission: "users.export.ids",
    reason:
      "Braze implements this read as a POST, so classifying by HTTP method calls it a write and a " +
      "read-only profile refuses it. Exporting profiles changes nothing and may be repeated safely.",
  },
  "users.export.segment.create": {
    access: "read",
    retryPolicy: "read-safe",
    permission: "users.export.segment",
    reason: "A POST-shaped read, same as users.export.ids.",
  },
  "users.export.global-control-group.create": {
    access: "read",
    retryPolicy: "read-safe",
    permission: "users.export.global_control_group",
    reason: "A POST-shaped read, same as users.export.ids.",
  },
  "users.track.create": {
    permission: "users.track",
    batch: { attributes: 75, events: 75, purchases: 75 },
    reason: "Braze caps each array in the body at 75 per request (§10). The bulk pipeline needs it in Phase 3.",
  },
  "v2.subscription.status.set.create": {
    permission: "subscription.status.set",
    batch: { subscription_groups: 50 },
    reason: "Braze's own description caps this at 50 users per request; the collection carries it as prose only.",
  },
  "subscription.status.set.create": {
    permission: "subscription.status.set",
    batch: { subscription_groups: 50 },
    reason: "The v1 form of the same endpoint, with the same 50-user cap.",
  },
  "catalogs.by-id.items.update": {
    description: "Use this endpoint to edit multiple items in your catalog.",
    reason:
      "Braze's collection describes this PATCH with the sentence for the DELETE on the same path — " +
      "'Use this endpoint to delete multiple items in your catalog.' Their own copy-paste, and it " +
      "reaches --help, `braze commands --json` and the generated docs, so an agent picking a " +
      "command by description reads 'delete' for the endpoint that edits (BUG-6).",
  },
  "campaigns.list.get": {
    pagination: "page",
    pageSize: 100,
    permission: "campaigns.list",
    reason:
      "Paged by a 0-indexed `page` parameter, which the collection shows but does not label as " +
      "pagination. Braze's own description says the rows come in groups of 100.",
  },
  "canvas.list.get": {
    pagination: "page",
    pageSize: 100,
    permission: "canvas.list",
    reason: "Paged like campaigns.list.",
  },
  "events.list.get": {
    pagination: "page",
    pageSize: 250,
    permission: "events.list",
    reason:
      "Paged like campaigns.list but with a different page size — Braze documents 250 event names " +
      "per page, not 100. FIND-19: this had no pagination at all, so the CLI could not tell a full " +
      "page from the last one, and --paginate would have done nothing.",
  },
  "purchases.product-list.get": {
    pagination: "page",
    permission: "purchases.product_list",
    reason:
      "Paged, but Braze documents no page size for it — so there is deliberately no pageSize here. " +
      "Guessing 100 would make the CLI claim 'that is all of them' at a boundary it does not know. " +
      "Without it the page note degrades to a row count, which is honest (FIND-19).",
  },
  "feed.list.get": {
    pagination: "page",
    permission: "feed.list",
    reason: "Paged, with no documented page size, same as purchases.product-list (FIND-19).",
  },
  "segments.list.get": {
    pagination: "page",
    pageSize: 100,
    permission: "segments.list",
    reason: "Paged like campaigns.list.",
  },
}
