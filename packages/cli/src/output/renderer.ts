import type { OutputFormat } from "../config/file.js"
import { renderPretty } from "./pretty.js"
import { processStreams, type Streams } from "./stream.js"

export interface Renderer {
  /** The one thing a caller asked for. In a machine mode this is the whole of stdout. */
  result(value: unknown): void
  /** Each item on its own line. Only meaningful in `jsonl`; elsewhere it renders the whole list. */
  stream(items: Iterable<unknown>): void
  note(message: string): void
  success(message: string): void
  warn(message: string): void
  failure(message: string): void
}

export interface RendererOptions {
  format: OutputFormat
  color: boolean
  streams?: Streams
}

/**
 * **Every diagnostic goes to stderr, in every mode — pretty included.**
 *
 * The brief only requires that of the machine modes, but making it unconditional means §44 holds
 * by construction instead of by a mode check somebody can forget. It also means piping human
 * output still gives you the content and not the commentary.
 */
export const createRenderer = ({ format, color, streams = processStreams }: RendererOptions): Renderer => {
  const mark = (symbol: string, message: string) => `${symbol} ${message}`

  const diagnostics = {
    note: (message: string) => streams.diagnostic(format === "pretty" ? mark("·", message) : message),
    success: (message: string) => streams.diagnostic(format === "pretty" ? mark("✓", message) : message),
    warn: (message: string) => streams.diagnostic(format === "pretty" ? mark("!", message) : message),
    failure: (message: string) => streams.diagnostic(format === "pretty" ? mark("✗", message) : message),
  }

  if (format === "jsonl") {
    return {
      ...diagnostics,
      result: (value) => streams.data(JSON.stringify(value)),
      stream: (items) => {
        for (const item of items) streams.data(JSON.stringify(item))
      },
    }
  }

  if (format === "pretty") {
    return {
      ...diagnostics,
      result: (value) => streams.data(renderPretty(value, { color })),
      stream: (items) => streams.data(renderPretty([...items], { color })),
    }
  }

  // json — exactly one deterministic value, and nothing else, ever.
  return {
    ...diagnostics,
    result: (value) => streams.data(JSON.stringify(value)),
    stream: (items) => streams.data(JSON.stringify([...items])),
  }
}
