import type { TokenStore } from './store.js'
import { AsyncEntry } from '@napi-rs/keyring'

export const KEYRING_SERVICE = 'difyctl'

function username(host: string, accountId: string): string {
  return `${host}::${accountId}`
}

export class KeyringBackend implements TokenStore {
  async put(host: string, accountId: string, token: string): Promise<void> {
    await new AsyncEntry(KEYRING_SERVICE, username(host, accountId)).setPassword(token)
  }

  async get(host: string, accountId: string): Promise<string | undefined> {
    try {
      const v = await new AsyncEntry(KEYRING_SERVICE, username(host, accountId)).getPassword()
      return v ?? undefined
    }
    catch {
      return undefined
    }
  }

  async delete(host: string, accountId: string): Promise<void> {
    try {
      await new AsyncEntry(KEYRING_SERVICE, username(host, accountId)).deletePassword()
    }
    catch { /* missing entry is fine */ }
  }

  async list(_host: string): Promise<readonly string[]> {
    return []
  }
}
