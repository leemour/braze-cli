import { readFileSync } from "node:fs"
import { BrazeError } from "brazecli-core"

export interface ReadInputOptions {
  /** Reads standard input. Injected so a test does not have to own the process's stdin. */
  readStdin?: () => string
}

/**
 * `@file`, `-` for standard input, or JSON given inline. Parsed and refused here rather than
 * inside a command, so a malformed body never reaches the point where it could be half-sent.
 */
export const readInput = (value: string, options: ReadInputOptions = {}): unknown => {
  if (value === "-") {
    return parse(readStdin(options), "standard input")
  }
  if (value.startsWith("@")) {
    const path = value.slice(1)
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch (error) {
      throw new BrazeError("validation_error", `cannot read ${path}: ${error instanceof Error ? error.message : error}`)
    }
    return parse(text, path)
  }
  return parse(value, "the --input value")
}

const readStdin = (options: ReadInputOptions): string => {
  if (options.readStdin) return options.readStdin()
  try {
    return readFileSync(0, "utf8")
  } catch (error) {
    throw new BrazeError(
      "validation_error",
      `cannot read standard input: ${error instanceof Error ? error.message : error}`,
    )
  }
}

const parse = (text: string, origin: string): unknown => {
  if (text.trim() === "") {
    throw new BrazeError("validation_error", `${origin} is empty`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new BrazeError(
      "validation_error",
      `${origin} is not valid JSON: ${error instanceof Error ? error.message : error}`,
    )
  }
}
