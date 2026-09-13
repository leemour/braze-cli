import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CredentialStorage } from "../config/file.js"
import { writeSecurely } from "../config/file.js"
import { type KeyringStore, systemKeyring } from "./keyring.js"

export const KEYRING_SERVICE = "brazecli"

export type CredentialSource = "environment" | "keyring" | "file"

export interface StoredCredential {
  apiKey: string
  source: CredentialSource
}

export interface CredentialsOptions {
  configDir: string
  storage?: CredentialStorage
  keyring?: KeyringStore
  env?: NodeJS.ProcessEnv
  /** Where the one-line warning goes when the keyring is unavailable. Never stdout. */
  warn?: (message: string) => void
}

const credentialsPath = (configDir: string) => join(configDir, "credentials.json")

type FileStore = Record<string, { apiKey?: string }>

const readFileStore = (configDir: string): FileStore => {
  try {
    return JSON.parse(readFileSync(credentialsPath(configDir), "utf8")) as FileStore
  } catch {
    return {}
  }
}

const writeFileStore = (configDir: string, store: FileStore): void => {
  writeSecurely(credentialsPath(configDir), `${JSON.stringify(store, null, 2)}\n`, 0o600)
}

/**
 * Environment first, then the OS keyring, then a file — the order the brief fixes.
 *
 * `auto` does not probe whether a keyring exists: it attempts the operation, and on failure warns
 * once and falls through. A probe would touch the user's keychain for nothing and could still
 * succeed where the real operation fails.
 */
export class Credentials {
  readonly #configDir: string
  readonly #storage: CredentialStorage
  readonly #keyring: KeyringStore
  readonly #env: NodeJS.ProcessEnv
  readonly #warn: (message: string) => void
  #warned = false

  constructor(options: CredentialsOptions) {
    this.#configDir = options.configDir
    this.#storage = options.storage ?? "auto"
    this.#keyring = options.keyring ?? systemKeyring
    this.#env = options.env ?? process.env
    this.#warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`))
  }

  read(profile: string): StoredCredential | undefined {
    const fromEnv = this.#env.BRAZE_API_KEY?.trim()
    if (fromEnv) return { apiKey: fromEnv, source: "environment" }

    if (this.#storage !== "file") {
      const fromKeyring = this.#tryKeyring(() => this.#keyring.get(KEYRING_SERVICE, profile))
      if (fromKeyring) return { apiKey: fromKeyring, source: "keyring" }
    }

    const fromFile = readFileStore(this.#configDir)[profile]?.apiKey
    return fromFile ? { apiKey: fromFile, source: "file" } : undefined
  }

  write(profile: string, apiKey: string): CredentialSource {
    if (this.#storage !== "file") {
      const stored = this.#tryKeyring(() => {
        this.#keyring.set(KEYRING_SERVICE, profile, apiKey)
        return true
      })
      if (stored) return "keyring"
    }

    const store = readFileStore(this.#configDir)
    store[profile] = { apiKey }
    writeFileStore(this.#configDir, store)
    return "file"
  }

  remove(profile: string): CredentialSource[] {
    const removed: CredentialSource[] = []

    if (this.#storage !== "file" && this.#tryKeyring(() => this.#keyring.delete(KEYRING_SERVICE, profile))) {
      removed.push("keyring")
    }

    const store = readFileStore(this.#configDir)
    if (store[profile] !== undefined) {
      delete store[profile]
      writeFileStore(this.#configDir, store)
      removed.push("file")
    }

    return removed
  }

  #tryKeyring<T>(operation: () => T): T | undefined {
    if (this.#storage === "keyring") return operation()

    try {
      return operation()
    } catch (error) {
      if (!this.#warned) {
        this.#warned = true
        this.#warn(
          `the OS keyring is unavailable (${error instanceof Error ? error.message : String(error)}); ` +
            "falling back to a file in the config directory",
        )
      }
      return undefined
    }
  }
}
