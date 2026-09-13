// Must stay green: ordinary prose containing the word "process", and a field named `process`.
// A gate that fails on these cries wolf and gets deleted.
export const note = "the queue will process records in order"
export const shape = { process: "submitted" } as const
