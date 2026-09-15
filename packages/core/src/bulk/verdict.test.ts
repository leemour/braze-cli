import { describe, expect, it } from "vitest"
import type { BulkRecord } from "./types.js"
import { type Placement, verdictsFor } from "./verdict.js"

const place = (...fields: string[]): Placement[] => {
  const counts: Record<string, number> = {}
  return fields.map((field, position) => {
    const index = counts[field] ?? 0
    counts[field] = index + 1
    return { record: { row: position + 1, field, value: {} } as BulkRecord, field, index }
  })
}

const statuses = (placed: Placement[], body: unknown): string[] =>
  placed.map((placement) => verdictsFor(placed, body).get(placement.record.row)?.status ?? "missing")

/**
 * The response Braze actually sent on 2026-09-15, copied from the staging measurement rather than
 * simplified by hand: five `attributes` objects, of which it refused three. It is the only evidence
 * there is that `index` and `input_array` exist at all — the documentation names neither.
 */
const MEASURED = {
  attributes_processed: 2,
  errors: [
    {
      index: 1,
      input_array: "attributes",
      type: "'email_subscribe' must be 'subscribed', 'unsubscribed', or 'opted_in'",
    },
    {
      index: 3,
      input_array: "attributes",
      type: "'push_subscribe' must be 'subscribed', 'unsubscribed', or 'opted_in'",
    },
    {
      index: 4,
      input_array: "attributes",
      type: "You must specify only one of 'external_id', 'user_alias' or 'braze_id'",
    },
  ],
  message: "success",
}

describe("the response Braze really sends", () => {
  it("fails exactly the records Braze named, and submits the rest", () => {
    const placed = place("attributes", "attributes", "attributes", "attributes", "attributes")

    expect(statuses(placed, MEASURED)).toEqual(["submitted", "failed", "submitted", "failed", "failed"])
  })

  it("carries Braze's own words for each refusal", () => {
    const placed = place("attributes", "attributes", "attributes", "attributes", "attributes")

    expect(verdictsFor(placed, MEASURED).get(5)?.errorMessage).toBe(
      "You must specify only one of 'external_id', 'user_alias' or 'braze_id'",
    )
  })

  it("says nothing extra when Braze's own counts add up", () => {
    const placed = place("attributes", "attributes", "attributes", "attributes", "attributes")

    expect([...verdictsFor(placed, MEASURED).values()].every((verdict) => verdict.note === undefined)).toBe(true)
  })

  it("leaves a clean batch submitted", () => {
    const placed = place("attributes", "attributes")

    expect(statuses(placed, { message: "success", attributes_processed: 2 })).toEqual(["submitted", "submitted"])
  })
})

describe("counting by array, not by request", () => {
  /**
   * `index` is 0-based inside `input_array`. Reading it as a position in the request would blame
   * the wrong user — the failure this test exists to catch, because both readings look right.
   */
  it("reads the index within the named array", () => {
    const placed = place("attributes", "events", "attributes", "events")
    const body = { errors: [{ index: 1, input_array: "events", type: "bad event" }] }

    // events index 1 is row 4, not row 2.
    expect(statuses(placed, body)).toEqual(["submitted", "submitted", "submitted", "failed"])
  })
})

describe("an error that cannot be placed", () => {
  it("makes the named array unknown, and leaves the other arrays alone", () => {
    const placed = place("attributes", "events", "attributes")
    const body = { errors: [{ input_array: "attributes", type: "something went wrong" }] }

    expect(statuses(placed, body)).toEqual(["unknown", "submitted", "unknown"])
  })

  it("makes the whole batch unknown when Braze names no array either", () => {
    const placed = place("attributes", "events")

    expect(statuses(placed, { errors: [{ type: "something went wrong" }] })).toEqual(["unknown", "unknown"])
  })

  /** An index past what we sent identifies nothing, and guessing which record it meant is the lie. */
  it("treats an index we never sent as unplaceable rather than crashing", () => {
    const placed = place("attributes", "attributes")

    expect(statuses(placed, { errors: [{ index: 97, input_array: "attributes", type: "?" }] })).toEqual([
      "unknown",
      "unknown",
    ])
  })

  it("keeps a record Braze did name failed, even when another error is unplaceable", () => {
    const placed = place("attributes", "attributes")
    const body = {
      errors: [
        { index: 0, input_array: "attributes", type: "named" },
        { input_array: "attributes", type: "unnamed" },
      ],
    }

    expect(statuses(placed, body)).toEqual(["failed", "unknown"])
  })

  it("says in the row itself that the error was not tied to a record", () => {
    const placed = place("attributes")

    expect(verdictsFor(placed, { errors: [{ type: "mystery" }] }).get(1)?.errorMessage).toContain("did not tie")
  })
})

describe("when Braze's numbers do not add up", () => {
  /**
   * The tempting rule is "the remainder is `unknown`". It is the wrong way to be wrong: the field
   * counts what Braze *queued*, one measurement is not an arithmetic guarantee, and a benign
   * mismatch would turn a whole run of truthful rows into `unknown` ones.
   */
  it("keeps the records submitted and notes the discrepancy", () => {
    const placed = place("attributes", "attributes", "attributes")
    const verdicts = verdictsFor(placed, { message: "success", attributes_processed: 1 })

    expect([...verdicts.values()].map((verdict) => verdict.status)).toEqual(["submitted", "submitted", "submitted"])
    expect(verdicts.get(1)?.note).toContain("2 unaccounted for")
  })

  it("does not note anything when Braze reports no count at all", () => {
    const placed = place("subscription_groups")

    expect(verdictsFor(placed, { message: "success" }).get(1)?.note).toBeUndefined()
  })
})

describe("a body we do not recognise", () => {
  it("changes nothing rather than throwing", () => {
    const placed = place("attributes", "attributes")

    expect(statuses(placed, { message: "success" })).toEqual(["submitted", "submitted"])
    expect(statuses(placed, "not an object")).toEqual(["submitted", "submitted"])
    expect(statuses(placed, null)).toEqual(["submitted", "submitted"])
    expect(statuses(placed, { errors: "not an array" })).toEqual(["submitted", "submitted"])
  })

  it("keeps an error entry that is not an object, rather than dropping it silently", () => {
    const placed = place("attributes")

    expect(statuses(placed, { errors: ["just a string"] })).toEqual(["unknown"])
  })
})
