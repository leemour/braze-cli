/**
 * The line every machine mode depends on: **stdout carries data, stderr carries everything
 * else.** Two functions and no formatting decisions — the renderer that chooses tables, colour
 * and spinners is `CLI-5` and sits on top of this, never beside it.
 */
export interface Streams {
  data: (text: string) => void
  diagnostic: (text: string) => void
}

export const processStreams: Streams = {
  data: (text) => {
    process.stdout.write(`${text}\n`)
  },
  diagnostic: (text) => {
    process.stderr.write(`${text}\n`)
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
  }
}
