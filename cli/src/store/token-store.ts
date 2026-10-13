import type { LocalFile } from './local-file'
import { AsyncEntry } from '@napi-rs/keyring'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { BINARY } from '@/version/info'

/**
 * Credential store keyed by an opaque (host, email) pair.
 */
export type TokenStore = {
  read: (host: string, email: string) => Promise<string>
  write: (host: string, email: string, bearer: string) => Promise<void>
  remove: (host: string, email: string) => Promise<void>
}

const KEYCHAIN_ENTRY_PREFIX = 'tokens'

export const TOKENS_SCHEMA = z.object({
  tokens: z.record(z.string(), z.record(z.string(), z.string())).default({}),
})

type TokensDoc = z.infer<typeof TOKENS_SCHEMA>

export type TokensFile = LocalFile<TokensDoc>

export class FileTokenStore implements TokenStore {
  private readonly file: TokensFile

  constructor(file: TokensFile) {
    this.file = file
  }

  async read(host: string, email: string): Promise<string> {
    return (await this.file.read())?.tokens[host]?.[email] ?? ''
  }

  async write(host: string, email: string, bearer: string): Promise<void> {
    const doc = (await this.file.read()) ?? { tokens: {} }
    doc.tokens[host] = { ...doc.tokens[host], [email]: bearer }
    await this.file.write(doc)
  }

  async remove(host: string, email: string): Promise<void> {
    const doc = await this.file.read()
    const hostMap = doc?.tokens[host]
    if (doc === null || hostMap === undefined || !(email in hostMap)) return
    delete hostMap[email]
    if (Object.keys(hostMap).length === 0) delete doc.tokens[host]
    await this.file.write(doc)
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
      raw = await new AsyncEntry(this.service, this.entry(host, email)).getPassword()
    } catch (err) {
      throw keyringUnavailableError(err)
    }
    if (raw === null || raw === undefined || raw === '') return ''
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : ''
    } catch {
      return ''
    }
  }

  async write(host: string, email: string, bearer: string): Promise<void> {
    try {
      await new AsyncEntry(this.service, this.entry(host, email)).setPassword(
        JSON.stringify(bearer),
      )
    } catch (err) {
      throw keyringUnavailableError(err)
    }
  }

  async remove(host: string, email: string): Promise<void> {
    try {
      await new AsyncEntry(this.service, this.entry(host, email)).deletePassword()
    } catch {
      /* missing entry is fine */
    }
  }

  private entry(host: string, email: string): string {
    return `${KEYCHAIN_ENTRY_PREFIX}.${host}.${email}`
  }
}

function keyringUnavailableError(cause: unknown): BaseError {
  return new BaseError({
    code: ErrorCode.KeyringUnavailable,
    message: 'OS keychain is unreachable',
    hint: `unlock the keychain (or the login session) and retry, or run ${BINARY} login --no-keyring to keep the token in a file`,
    cause,
  })
}
