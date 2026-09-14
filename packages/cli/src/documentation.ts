/**
 * Where a caller finds the endpoint paths. The catalog will make them discoverable from the CLI
 * itself (`CAT-7`); until then this pointer is the honest answer, and it lives in one place so
 * help text and `braze commands` cannot drift apart.
 */
export const DOCUMENTATION = {
  /** Braze's own index of every endpoint, grouped by resource. */
  endpoints: "https://www.braze.com/docs/api/home",
  /** Authentication, rate limits and the shape of a Braze response. */
  basics: "https://www.braze.com/docs/api/basics",
} as const

/**
 * What to run when there is no profile yet.
 *
 * The endpoint is a placeholder **that cannot be pasted and run** — spaces and angle brackets make
 * the shell reject it — rather than a real-looking URL. Both failure modes have happened here: a
 * `https://rest.XXX.braze.YYY` was pasted into a config verbatim (`UX-1`), and a plausible-looking
 * `rest.fra-01.braze.com`, which does not exist, was typed from memory (`BUG-5`). A real example
 * would also be wrong for most readers, since the cluster differs per customer.
 */
export const firstProfileHint = (configPath: string): string =>
  [
    "No profile is configured yet. Create one:",
    "",
    "  braze profile add production --endpoint <your Braze REST endpoint> --read-only",
    "",
    "Your endpoint depends on which Braze cluster you are on, and is listed against your",
    `dashboard URL at  ${DOCUMENTATION.basics}`,
    "The key is asked for on the terminal, never passed as an argument, and is kept in the OS keyring.",
    "",
    `Profiles live in ${configPath}`,
  ].join("\n")
