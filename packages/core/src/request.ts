import { BrazeError } from "./errors.js"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"

export type QueryValue = string | number | boolean | undefined | null

export interface RequestSpec {
  method: HttpMethod
  /** A Braze path, always relative: `/users/track`, `/campaigns/details`, `/catalogs/{name}`. */
  path: string
  pathParams?: Record<string, string | number>
  query?: Record<string, QueryValue>
  /** Serialized as JSON. Absent means no body. */
  body?: unknown
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Only a path, never a whole URL. §64 of the brief: a raw command must not be able to send
 * production credentials to an arbitrary host by pasting one in.
 */
export const resolvePath = (path: string, params: Record<string, string | number> = {}): string => {
  if (path.includes("://")) {
    throw new BrazeError("validation_error", `expected a Braze path such as /users/track, got a URL: ${path}`)
  }
  if (!path.startsWith("/")) {
    throw new BrazeError("validation_error", `a Braze path must start with "/", got: ${path}`)
  }

  const used = new Set<string>()
  const resolved = path.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name]
    if (value === undefined) {
      throw new BrazeError("validation_error", `path ${path} needs a value for {${name}}`)
    }
    used.add(name)
    return encodeURIComponent(String(value))
  })

  const unused = Object.keys(params).filter((name) => !used.has(name))
  if (unused.length > 0) {
    throw new BrazeError("validation_error", `path ${path} has no placeholder for: ${unused.join(", ")}`)
  }

  return resolved
}

export const buildQuery = (query: Record<string, QueryValue> = {}): URLSearchParams => {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      // Braze is not consistent about this across endpoints, and guessing would silently send
      // the wrong shape. The generated catalog settles it per operation — `CAT-3`.
      throw new BrazeError(
        "validation_error",
        `query parameter "${key}" is an array, and how Braze expects those is not settled yet — pass a scalar`,
      )
    }
    params.set(key, String(value))
  }

  return params
}

/** HTTPS everywhere except an explicit loopback host, which is what a mock server runs on. */
export const resolveEndpoint = (endpoint: string): URL => {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new BrazeError("configuration_error", `REST endpoint is not a URL: ${endpoint}`)
  }

  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !loopback) {
    throw new BrazeError("configuration_error", `REST endpoint must be https, got: ${endpoint}`)
  }

  return url
}

export const buildUrl = (endpoint: URL, spec: RequestSpec): URL => {
  const url = new URL(endpoint.origin)
  url.pathname = resolvePath(spec.path, spec.pathParams)
  url.search = buildQuery(spec.query).toString()
  return url
}
