/**
 * The line every machine mode depends on: **stdout carries data, stderr carries everything
 * else.** Two functions and no formatting decisions — the renderer that chooses tables, colour
 * and spinners is `CLI-5` and sits on top of this, never beside it.
 */
export interface Streams {
  data: (text: string) => void
  diagnostic: (text: string) => void
  /**
   * A line that replaces itself — a progress counter, and nothing else.
   *
   * It lives here rather than beside the renderer so that a test capturing streams captures this
   * too: the invariant it could break is rule 3, and an output channel the machine-output test
   * cannot see is exactly how that gets broken quietly. An empty string clears the line.
   */
  progress?: (text: string) => void
}

export const processStreams: Streams = {
  data: (text) => {
    process.stdout.write(`${text}\n`)
  },
  diagnostic: (text) => {
    process.stderr.write(`${text}\n`)
  },
  progress: (text) => {
    // Carriage return and no newline, so the next line overwrites this one. Padded to the width of
    // what was there before, or the tail of a longer previous line is left on screen.
    process.stderr.write(`\r${text.padEnd(72)}${text === "" ? "\r" : ""}`)
  },
}

/** Collects both halves separately, so a test can assert nothing leaked across. */
export const captureStreams = (): Streams & { stdout: string[]; stderr: string[] } => {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    stdout,
    stderr,
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    progress: (text) => stderr.push(text),
  }
}
