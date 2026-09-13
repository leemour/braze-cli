import { createRequire } from "node:module"

/**
 * The one seam through which the OS keychain is reached. Injected like `fetch` in core, so
 * "no test touched the developer's real keychain" is a property of the code rather than a hope
 * about every test remembering to opt out.
 */
export interface KeyringStore {
  get(service: string, account: string): string | null
  set(service: string, account: string, secret: string): void
  delete(service: string, account: string): boolean
}

interface Entry {
  getPassword(): string | null
  setPassword(secret: string): void
  deletePassword(): boolean
}

type EntryConstructor = new (service: string, account: string) => Entry

const require = createRequire(import.meta.url)
let cached: EntryConstructor | undefined

// Loaded on first use, not at import: `@napi-rs/keyring` is a native module, and a machine
// where its binary is missing must still be able to run in file mode.
const entryClass = (): EntryConstructor => {
  cached ??= (require("@napi-rs/keyring") as { Entry: EntryConstructor }).Entry
  return cached
}

export const systemKeyring: KeyringStore = {
  // Returns null for an absent entry rather than throwing — measured against @napi-rs/keyring
  // on 2026-09-13, and the difference matters: a throw here means the keychain is unusable.
  get: (service, account) => new (entryClass())(service, account).getPassword(),
  set: (service, account, secret) => {
    ;new (entryClass())(service, account).setPassword(secret)
  },
  delete: (service, account) => new (entryClass())(service, account).deletePassword(),
}

/** An in-memory stand-in. Every test uses this; none can reach the real keychain. */
export const memoryKeyring = (
  initial: Record<string, string> = {},
): KeyringStore & { entries: Map<string, string> } => {
  const entries = new Map(Object.entries(initial))
  const key = (service: string, account: string) => `${service}:${account}`

  return {
    entries,
    get: (service, account) => entries.get(key(service, account)) ?? null,
    set: (service, account, secret) => {
      entries.set(key(service, account), secret)
    },
    delete: (service, account) => entries.delete(key(service, account)),
  }
}

/** Refuses every operation, so the fallback path can be tested. */
export const brokenKeyring = (message = "no secret service available"): KeyringStore => ({
  get: () => {
    throw new Error(message)
  },
  set: () => {
    throw new Error(message)
  },
  delete: () => {
    throw new Error(message)
  },
})
