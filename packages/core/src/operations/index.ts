import type { Operation } from "../operation.js"
import { generatedOperations } from "./generated.js"

/**
 * Every operation the CLI knows, ready to be turned into commands. Generated from the committed
 * snapshot today; `CAT-4` merges handwritten overrides on top of it here, which is why callers
 * should read this and never `generatedOperations` directly.
 */
export const catalog: readonly Operation[] = generatedOperations

export const findOperation = (id: string): Operation | undefined => catalog.find((operation) => operation.id === id)

/** Commands are matched as whole words, so `["campaigns", "list"]` never matches `campaigns`. */
export const findByCommand = (command: readonly string[]): Operation | undefined =>
  catalog.find(
    (operation) =>
      operation.command.length === command.length && operation.command.every((word, index) => word === command[index]),
  )
