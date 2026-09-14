import * as v from "valibot"

/**
 * Handwritten request schemas, keyed by `Operation.id`. An operation appears here **only** if it
 * is also marked `validation: "strict"` in `overrides.ts`, and the merge fails loudly if the two
 * disagree — a strict operation with no schema is this feature silently doing nothing.
 *
 * Kept apart from `overrides.ts` because an override is data merged into an `Operation` and a
 * schema is code: it cannot be written into `generated.ts` or compared by `catalog:check`.
 *
 * **Every schema here cites the Braze page it was read from, and encodes nothing that page does
 * not state.** A wrong strict schema refuses a request Braze would have accepted, and the caller
 * has no way to overrule it except `braze api`. Where a page leaves a rule ambiguous, the
 * operation stays `generated` and this file says why — a smaller strict set that is right beats a
 * fuller one that guesses.
 *
 * What is deliberately NOT here, and why:
 *
 * - `messages.send.create` — the identifier rules interact with audience, segment and recipient
 *   objects in ways the docs state across several pages. Ambiguous, so it stays `generated`.
 * - `campaigns.trigger.send.create` — same shape of problem: `recipients` overlaps `audience` and
 *   the "at least one" rule is not stated in one place.
 */
export const schemas: Readonly<Record<string, v.GenericSchema>> = {
  /**
   * https://www.braze.com/docs/api/endpoints/user_data/post_user_track
   *
   * "Each `/users/track` request can contain up to 75 total objects combined across `attributes`,
   * `events`, and `purchases`." The per-array 75 is Braze's own legacy limit (`BUG-8`).
   */
  "users.track.create": v.pipe(
    v.object({
      attributes: v.optional(v.array(v.looseObject({}))),
      events: v.optional(v.array(v.looseObject({}))),
      purchases: v.optional(v.array(v.looseObject({}))),
    }),
    v.check(
      (body) => total(body) > 0,
      "a users track request must carry at least one of attributes, events or purchases",
    ),
    v.check(
      (body) => total(body) <= 75,
      "Braze accepts at most 75 objects per request, counted across attributes, events and purchases together",
    ),
  ),

  /**
   * https://www.braze.com/docs/api/endpoints/user_data/post_user_delete
   *
   * "Only one of `external_ids`, `user_aliases`, `braze_ids`, `email_addresses`, or
   * `phone_numbers` can be included in a single request", and "up to 50" of whichever it is.
   */
  "users.delete.create": v.pipe(
    v.object({
      external_ids: v.optional(v.array(v.string())),
      user_aliases: v.optional(v.array(v.looseObject({}))),
      braze_ids: v.optional(v.array(v.string())),
      email_addresses: v.optional(v.array(v.string())),
      phone_numbers: v.optional(v.array(v.string())),
    }),
    v.check(
      (body) => present(body).length === 1,
      "a users delete request carries exactly one of external_ids, user_aliases, braze_ids, email_addresses or phone_numbers — Braze refuses a request with two",
    ),
    v.check(
      (body) => Object.values(body).every((list) => !Array.isArray(list) || list.length <= 50),
      "Braze accepts at most 50 identifiers per delete request",
    ),
  ),
}

const total = (body: Record<string, unknown>): number =>
  ["attributes", "events", "purchases"].reduce((sum, field) => {
    const list = body[field]
    return sum + (Array.isArray(list) ? list.length : 0)
  }, 0)

const present = (body: Record<string, unknown>): string[] =>
  Object.entries(body)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([field]) => field)
