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
