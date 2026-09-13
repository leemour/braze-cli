/**
 * The one function `BrazeClient` needs from its environment. A Worker, a browser, a test and
 * Node all satisfy it; nothing else about the runtime is assumed.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
