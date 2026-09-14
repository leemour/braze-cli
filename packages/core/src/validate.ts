import * as v from "valibot"
import { BrazeError } from "./errors.js"
import type { Operation } from "./operation.js"
import { recordSchemas, schemas } from "./operations/schemas.js"
import { buildQuery, type QueryValue, resolvePath } from "./request.js"

export interface ValidatableInput {
  pathParams?: Record<string, string | number>
  query?: Record<string, QueryValue>
  body?: unknown
}

/**
 * Checks a request as far as we honestly can before it costs an HTTP call.
 *
 * A function rather than a method on `BrazeClient` because it has two callers: the client, before
 * its attempt loop, and the CLI's `--dry-run`, which returns before a client ever exists. §550 of
 * the brief says a dry run validates, and a command whose whole purpose is "tell me whether this
 * would work" must not answer "probably".
 *
 * **It never reaches the network and never mutates the input.** Everything it can say, it says
 * from the operation and the input alone.
 */
export const validateRequest = (operation: Operation, input: ValidatableInput = {}): void => {
  // Both already refuse the things they know about — a missing placeholder, an absolute URL, an
  // array where Braze's encoding is unsettled. Calling them here moves those refusals to before
  // the request is built rather than during it, which is the whole point of validating.
  resolvePath(operation.path, input.pathParams)
  buildQuery(input.query)

  const level = operation.validation ?? "generated"
  if (level === "passthrough") return

  if (level === "strict") {
    const schema = schemas[operation.id]
    if (!schema) {
      throw new BrazeError(
        "validation_error",
        `operation "${operation.id}" is marked strict but has no schema — the catalog is inconsistent`,
        { operation: operation.id },
      )
    }
    if (input.body === undefined) {
      throw new BrazeError("validation_error", `${operation.id} needs a request body`, { operation: operation.id })
    }

    const result = v.safeParse(schema, input.body)
    if (!result.success) throw refusal(operation, result.issues)
    return
  }

  checkKind(operation, input.body)
}

/**
 * What is wrong with a single record of a batch, or `undefined` when nothing is.
 *
 * **It returns a reason instead of throwing.** A record that cannot be sent is an outcome, not an
 * error: it gets an audit row saying `invalid` and why, the run carries on, and the other 74
 * records of its batch still go (`NEED-31`, §34). One bad line in two million ending the run is the
 * thing this shape exists to prevent.
 *
 * That is also where it goes beyond `validateRequest`, which checks an assembled body. By then the
 * malformed record has already taken 74 innocent ones with it.
 */
export const checkRecord = (operation: Operation, field: string, value: unknown): string | undefined => {
  const fields = operation.batch
  if (fields && !(field in fields)) {
    return `${operation.id} has no batch field "${field}" — it takes ${Object.keys(fields).join(", ")}`
  }

  const schema = recordSchemas[operation.id]?.[field]
  if (!schema) return undefined

  const result = v.safeParse(schema, value)
  return result.success ? undefined : issueText(result.issues)
}

/**
 * What `generated` is allowed to say about a body, and no more.
 *
 * **Nothing about which keys are allowed.** One example is not a schema: `/users/track`'s example
 * shows three fields, a request carrying only one of them is valid, and so is one carrying a field
 * Braze added last week. Refusing those would be the wrong-schema failure this level exists to
 * avoid. The JSON *kind* is a different matter — an array where Braze documents an object cannot
 * work, whatever else is true.
 */
const checkKind = (operation: Operation, body: unknown): void => {
  const documented = operation.requestBody

  if (!documented) {
    // Braze documents no body for a GET or DELETE, so sending one is a mistake we can name without
    // any schema at all. A write with no documented body we simply cannot judge.
    if (body !== undefined && (operation.method === "GET" || operation.method === "DELETE")) {
      throw new BrazeError(
        "validation_error",
        `${operation.method} ${operation.path} takes no request body, and one was given`,
        { operation: operation.id },
      )
    }
    return
  }

  if (documented.source !== "example" || body === undefined) return

  const wanted = kindOf(documented.example)
  const given = kindOf(body)

  if (wanted !== given) {
    throw new BrazeError(
      "validation_error",
      `${operation.id} expects a JSON ${wanted} as its body, and was given ${given === "null" ? "null" : `a ${given}`}. ` +
        "Run `braze schema " +
        operation.command.join(" ") +
        "` to see Braze's own example.",
      { operation: operation.id },
    )
  }
}

const kindOf = (value: unknown): string => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

/** Names the field, because "invalid request" costs the reader a round trip to find out which. */
const refusal = (operation: Operation, issues: readonly v.BaseIssue<unknown>[]): BrazeError =>
  new BrazeError("validation_error", `${operation.id}: ${issueText(issues)}`, { operation: operation.id })

const issueText = (issues: readonly v.BaseIssue<unknown>[]): string => {
  const first = issues[0] as v.BaseIssue<unknown>
  const path = first.path?.map((segment) => String((segment as { key?: unknown }).key ?? "")).join(".")

  return path ? `${path} — ${first.message}` : first.message
}
