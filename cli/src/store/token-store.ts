import { AsyncEntry } from '@napi-rs/keyring'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { YamlStore } from './store'

/**
 * Credential store keyed by an opaque (host, email) pair.
 */
export type TokenStore = {
  read: (host: string, email: string) => Promise<string>
  write: (host: string, email: string, bearer: string) => Promise<void>
  remove: (host: string, email: string) => Promise<void>
}

const DOC_VERSION = 1

type TokenDoc = {
  version?: number
  tokens?: Record<string, Record<string, string>>
}

export class FileTokenStore implements TokenStore {
  private readonly store: YamlStore

  constructor(filePath: string) {
    this.store = new YamlStore(filePath)
  }

  async read(host: string, email: string): Promise<string> {
    const doc = await this.store.getTyped<TokenDoc>()
    if (doc === null)
      return ''
    // missing version = legacy pre-v1 format (same data shape); future unknown versions are rejected
    if (doc.version !== undefined && doc.version !== DOC_VERSION)
      return ''
    return doc.tokens?.[host]?.[email] ?? ''
  }

  async write(host: string, email: string, bearer: string): Promise<void> {
    const doc = await this.load()
    const hostMap = doc.tokens[host] ?? {}
    hostMap[email] = bearer
    doc.tokens[host] = hostMap
    await this.store.setTyped(doc)
  }

  async remove(host: string, email: string): Promise<void> {
    const doc = await this.store.getTyped<TokenDoc>()
    if (doc === null)
      return
    if (doc.version !== undefined && doc.version !== DOC_VERSION)
      return
    const tokens = doc.tokens ?? {}
    const hostMap = tokens[host]
    if (hostMap === undefined || !(email in hostMap))
      return
    delete hostMap[email]
    if (Object.keys(hostMap).length === 0)
      delete tokens[host]
    await this.store.setTyped({ version: DOC_VERSION, tokens })
  }

  private async load(): Promise<{ version: number, tokens: Record<string, Record<string, string>> }> {
    const doc = await this.store.getTyped<TokenDoc>()
    if (doc === null)
      return { version: DOC_VERSION, tokens: {} }
    if (doc.version !== undefined && doc.version !== DOC_VERSION)
      return { version: DOC_VERSION, tokens: {} }
    return { version: DOC_VERSION, tokens: (doc.tokens ?? {}) as Record<string, Record<string, string>> }
  }
}

/**
 * One OS-keyring entry per (host, email).
 */
export class KeychainTokenStore implements TokenStore {
  private readonly service: string

  constructor(service: string) {
    this.service = service
  }

  async read(host: string, email: string): Promise<string> {
    let raw: string | null | undefined
    try {
      raw = await new AsyncEntry(this.service, entryName(host, email)).getPassword()
    }
    catch (err) {
      throw keyringUnavailableError(err)
    }
    if (raw === null || raw === undefined || raw === '')
      return ''
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : ''
    }
    catch {
      return ''
    }
  }

  async write(host: string, email: string, bearer: string): Promise<void> {
    try {
      await new AsyncEntry(this.service, entryName(host, email)).setPassword(JSON.stringify(bearer))
    }
    catch (err) {
      throw keyringUnavailableError(err)
    }
  }

  async remove(host: string, email: string): Promise<void> {
    try {
      await new AsyncEntry(this.service, entryName(host, email)).deletePassword()
    }
    catch { /* missing entry is fine */ }
  }
}

function entryName(host: string, email: string): string {
  return `tokens.${host}.${email}`
}

function keyringUnavailableError(cause: unknown): BaseError {
  return new BaseError({
    code: ErrorCode.KeyringUnavailable,
    message: 'OS keychain is unreachable',
    hint: 'credentials are stored in the system keychain but it could not be accessed; unlock the keychain (or the login session) and retry',
    cause,
  })
}
