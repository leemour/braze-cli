import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { type BulkRecord, findOperation } from "brazecli-core"
import { describe, expect, it } from "vitest"
import { type RecordsOptions, readRecords, recordsFromStream } from "./records.js"

const track = findOperation("users.track.create") as NonNullable<ReturnType<typeof findOperation>>
const subscriptions = findOperation("v2.subscription.status.set.create") as NonNullable<
  ReturnType<typeof findOperation>
>

const dir = mkdtempSync(join(tmpdir(), "brazecli-records-"))

const file = (name: string, content: string): string => {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

const drain = async (records: AsyncIterable<BulkRecord>): Promise<BulkRecord[]> => {
  const all: BulkRecord[] = []
  for await (const record of records) all.push(record)
  return all
}

const read = (path: string, format: "jsonl" | "csv", options: RecordsOptions = {}) =>
  drain(readRecords(path, format, track, { field: "attributes", ...options }))

const message = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe("JSONL", () => {
  it("reads one record per line, numbered from one", async () => {
    const path = file("users.jsonl", '{"external_id":"u1"}\n{"external_id":"u2"}\n')

    const records = await read(path, "jsonl")

    expect(records.map((record) => record.row)).toEqual([1, 2])
    expect(records[1]?.value).toEqual({ external_id: "u2" })
    expect(records.every((record) => record.field === "attributes")).toBe(true)
  })

  /** Every editor ends a file with a newline; an empty record nobody wrote is an audit row nobody can act on. */
  it("skips blank lines rather than counting them as records", async () => {
    const path = file("blanks.jsonl", '{"external_id":"u1"}\n\n   \n{"external_id":"u2"}\n')

    expect((await read(path, "jsonl")).map((record) => record.row)).toEqual([1, 2])
  })

  it("names the record that is not JSON, since the file has two million of them", async () => {
    const path = file("broken.jsonl", '{"external_id":"u1"}\n{oops\n')

    expect(await message(() => read(path, "jsonl"))).toContain("record 2")
  })

  it("copies the identifiers out for the audit and leaves the record whole", async () => {
    const path = file("identity.jsonl", '{"external_id":"u1","salary":90000}\n')

    const [record] = await read(path, "jsonl")

    expect(record?.identity).toEqual({ external_id: "u1" })
    expect(record?.value).toEqual({ external_id: "u1", salary: 90000 })
  })

  it("takes the caller's own id from the key they name, and leaves it in the record", async () => {
    const path = file("ids.jsonl", '{"external_id":"u1","crm_id":"crm-4471"}\n')

    const [record] = await read(path, "jsonl", { recordIdKey: "crm_id" })

    expect(record?.recordId).toBe("crm-4471")
    expect((record?.value as Record<string, unknown> | undefined)?.crm_id).toBe("crm-4471")
  })

  it("leaves recordId unset when the named key is missing, so the executor generates one", async () => {
    const path = file("no-id.jsonl", '{"external_id":"u1"}\n')

    expect((await read(path, "jsonl", { recordIdKey: "crm_id" }))[0]?.recordId).toBeUndefined()
  })
})

describe("CSV", () => {
  it("reads the header as keys and each data row as a record", async () => {
    const path = file("users.csv", "external_id,first_name\nu1,Alex\nu2,Sam\n")

    const records = await read(path, "csv")

    expect(records.map((record) => record.row)).toEqual([1, 2])
    expect(records[0]?.value).toEqual({ external_id: "u1", first_name: "Alex" })
  })

  /**
   * The rule that looks clever — a number when it round-trips — puts two types in one column:
   * `1.5` becomes a number and `1.50` stays a string, decided by how somebody formatted a price.
   */
  it("keeps every cell a string, including the ones that look like numbers", async () => {
    const path = file("types.csv", "external_id,age,price,zip\nu1,25,1.50,01234\n")

    expect((await read(path, "csv"))[0]?.value).toEqual({
      external_id: "u1",
      age: "25",
      price: "1.50",
      zip: "01234",
    })
  })

  /** A blank in a spreadsheet means "nothing here", never "set this to the empty string". */
  it("omits an empty cell instead of sending it", async () => {
    const path = file("blank-cell.csv", "external_id,first_name\nu1,\n")

    expect((await read(path, "csv"))[0]?.value).toEqual({ external_id: "u1" })
  })

  it("handles a quoted field that contains a comma and a newline", async () => {
    const path = file("quoted.csv", 'external_id,note\nu1,"one, two\nthree"\n')

    const records = await read(path, "csv")

    expect(records).toHaveLength(1)
    expect((records[0]?.value as Record<string, string> | undefined)?.note).toBe("one, two\nthree")
  })

  /** `row` counts records everywhere — a JSONL line, a CSV data row, a database cursor position. */
  it("counts data rows, not lines, so a multi-line record still counts once", async () => {
    const path = file("rows.csv", 'external_id,note\nu1,"a\nb\nc"\nu2,plain\n')

    expect((await read(path, "csv")).map((record) => record.row)).toEqual([1, 2])
  })
})

describe("which array the file holds", () => {
  it("refuses to guess when the operation batches more than one field", async () => {
    const path = file("guess.jsonl", '{"external_id":"u1"}\n')

    const said = await message(() => drain(readRecords(path, "jsonl", track)))

    expect(said).toContain("--records-field")
    expect(said).toContain("attributes, events, purchases")
  })

  it("needs no flag when the operation batches exactly one field", async () => {
    const path = file("subs.jsonl", '{"external_id":"u1"}\n')

    const records = await drain(readRecords(path, "jsonl", subscriptions))

    expect(records[0]?.field).toBe("subscription_groups")
  })

  it("refuses a field the operation does not batch", async () => {
    const path = file("wrong-field.jsonl", '{"external_id":"u1"}\n')

    expect(await message(() => drain(readRecords(path, "jsonl", track, { field: "attribute" })))).toContain(
      "has no batch field",
    )
  })
})

describe("the source itself", () => {
  it("says which file it could not read", async () => {
    expect(await message(() => read(join(dir, "absent.jsonl"), "jsonl"))).toContain("absent.jsonl")
  })

  /** `--input` needs `@` to tell a file from inline JSON; `--records` has no inline form. */
  it("tolerates the @ prefix that --input requires", async () => {
    const path = file("at.jsonl", '{"external_id":"u1"}\n')

    expect(await read(`@${path}`, "jsonl")).toHaveLength(1)
  })
})

describe("nothing reads the whole file", () => {
  /**
   * §36: a two-million-line file must never become a two-million-element array.
   *
   * **The invariant is that what gets read does not grow with the file**, not that it is under some
   * number — the source is consumed up to a byte-sized buffer, so an absolute count in chunks says
   * more about how long the lines are than about whether anything streams. Measured in chunks
   * pulled rather than in heap, because a heap assertion is a coin flip and this is not.
   */
  const counting = (rows: number, render: (row: number) => string) => {
    const state = { pulled: 0 }
    let next = 0
    const stream = new Readable({
      read() {
        if (next >= rows) {
          this.push(null)
          return
        }
        state.pulled += 1
        this.push(render(next))
        next += 1
      },
    })
    return { state, stream }
  }

  const pulledForOneRecord = async (rows: number, format: "jsonl" | "csv"): Promise<number> => {
    const render =
      format === "csv"
        ? (row: number) => (row === 0 ? "external_id,note\n" : `u${row},padding text\n`)
        : (row: number) => `${JSON.stringify({ external_id: `u${row}`, note: "padding text" })}\n`

    const { state, stream } = counting(rows, render)
    const records = recordsFromStream(stream, format, track, { field: "attributes" })

    await records.next()
    await records.return(undefined as never)

    return state.pulled
  }

  it("reads no more of a JSONL source for a big file than for a small one", async () => {
    expect(await pulledForOneRecord(400_000, "jsonl")).toBe(await pulledForOneRecord(50_000, "jsonl"))
  })

  it("reads no more of a CSV source for a big file than for a small one", async () => {
    expect(await pulledForOneRecord(400_000, "csv")).toBe(await pulledForOneRecord(50_000, "csv"))
  })

  /** A generator that had already parsed the file would throw on line 3 before yielding line 1. */
  it("has not parsed the rest of the file by the time it yields the first record", async () => {
    const path = file("later-broken.jsonl", '{"external_id":"u1"}\n{"external_id":"u2"}\n{oops\n')

    const records = readRecords(path, "jsonl", track, { field: "attributes" })

    expect((await records.next()).value?.row).toBe(1)
    await records.return(undefined as never)
  })
})
