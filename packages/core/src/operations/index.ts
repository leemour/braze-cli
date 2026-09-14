import { defineOperation, type Operation } from "../operation.js"
import { generatedOperations } from "./generated.js"
import { type OperationOverride, overrides } from "./overrides.js"
import { parameterDescriptions } from "./parameters.js"
import { schemas } from "./schemas.js"

/**
 * Applies the handwritten corrections to the generated catalog.
 *
 * Exported so a test can drive it with its own inputs — the failure modes here are the expensive
 * kind, and they are much easier to prove on three operations than on ninety-five.
 */
export const applyOverrides = (
  generated: readonly Operation[],
  corrections: Readonly<Record<string, OperationOverride>>,
): readonly Operation[] => {
  const known = new Set(generated.map((operation) => operation.id))

  for (const id of Object.keys(corrections)) {
    if (!known.has(id)) {
      // The endpoint was renamed or withdrawn and the correction now describes nothing. Silently
      // ignoring it is how a safety classification like FIND-13's quietly stops being applied.
      throw new Error(`override "${id}" matches no operation — it is stale, or the id changed`)
    }
  }

  return generated.map((operation) => {
    const correction = corrections[operation.id]
    if (!correction) return operation

    const { reason: _reason, ...fields } = correction

    // Re-derived when the correction flips access without stating a policy: a POST-shaped read
    // left at `never` would keep the wrong answer to "may this be repeated".
    const retryPolicy =
      fields.retryPolicy ?? (fields.access && fields.access !== operation.access ? undefined : operation.retryPolicy)

    const merged = defineOperation({ ...operation, ...fields, retryPolicy })
    assertCoherent(merged)
    return merged
  })
}

/**
 * The check `operation.ts` asks for by name: a write that claims to be repeatable is a catalog
 * bug, and it has to be rejected here rather than handled at the point of retrying, because two
 * sources of truth for "may this be repeated" is how one of them ends up wrong.
 */
const assertCoherent = (operation: Operation): void => {
  if (operation.access === "write" && operation.retryPolicy === "read-safe") {
    throw new Error(`override "${operation.id}" makes a write read-safe — a repeat could duplicate the effect`)
  }
  if (operation.command.length === 0) {
    throw new Error(`override "${operation.id}" leaves the operation with no command`)
  }
  // The one way this feature silently becomes a no-op: an operation promises a handwritten schema
  // and there is none, so every request to it passes unchecked while the catalog says otherwise.
  if (operation.validation === "strict" && !schemas[operation.id]) {
    throw new Error(`override "${operation.id}" is marked strict but schemas.ts has no schema for it`)
  }
}

/**
 * Fills in what each query parameter means, where nothing said already.
 *
 * The collection carries no descriptions at all, so without this every flag in `--help` reads
 * "query parameter" — a line that looks like documentation and tells the reader nothing (`UX-5`).
 * An operation that already carries text keeps it: an override is more specific than the glossary
 * by definition, and a parameter nobody has described yet keeps its placeholder rather than
 * getting an invented one.
 */
export const describeParameters = (
  operations: readonly Operation[],
  descriptions: Readonly<Record<string, string>>,
): readonly Operation[] =>
  operations.map((operation) => {
    if (!operation.queryParameters?.length) return operation

    let changed = false
    const queryParameters = operation.queryParameters.map((parameter) => {
      const description = parameter.description ?? descriptions[parameter.name]
      if (description === undefined || description === parameter.description) return parameter
      changed = true
      return { ...parameter, description }
    })

    return changed ? { ...operation, queryParameters } : operation
  })

/**
 * Every operation the CLI knows: generated from the committed snapshot, with the handwritten
 * corrections merged on top. Read this, never `generatedOperations`.
 */
export const catalog: readonly Operation[] = describeParameters(
  applyOverrides(generatedOperations, overrides),
  parameterDescriptions,
)

export const findOperation = (id: string): Operation | undefined => catalog.find((operation) => operation.id === id)

/**
 * The catalog entry for a literal request, if there is one. Exact paths only: a request against
 * `/catalogs/my-catalog` is not matched to `/catalogs/{catalog_name}`, and falls back to judging
 * by method — which for a templated path is right anyway, since none of Braze's POST-shaped reads
 * take a path parameter.
 */
export const findByRequest = (method: string, path: string): Operation | undefined =>
  catalog.find((operation) => operation.method === method && operation.path === path)

/** Commands are matched as whole words, so `["campaigns", "list"]` never matches `campaigns`. */
export const findByCommand = (command: readonly string[]): Operation | undefined =>
  catalog.find(
    (operation) =>
      operation.command.length === command.length && operation.command.every((word, index) => word === command[index]),
  )
