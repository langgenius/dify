import type { StorageMode, Store } from './store'
import type { TokenStore } from './token-store'
import { join } from 'node:path'
import { resolveCacheDir, resolveConfigDir } from './dir'
import { YamlStore } from './store'
import { FileTokenStore, KeychainTokenStore } from './token-store'

export const CACHE_APP_INFO = 'app-info'
export const CACHE_NUDGE = 'nudge'
const HOSTS_FILE = 'hosts.yml'
const TOKENS_FILE = 'tokens.yml'
export const CONFIG_FILE_NAME = 'config.yml'

const KEYRING_SERVICE = 'difyctl'

function getStore(filePath: string): YamlStore {
  return new YamlStore(filePath)
}

export function cachePath(cacheDir: string, name: string): string {
  return join(cacheDir, `${name}.yml`)
}

export function getConfigurationStore(): YamlStore {
  return getStore(join(resolveConfigDir(), CONFIG_FILE_NAME))
}

export function getCache(cacheName: string): Store {
  return getStore(cachePath(resolveCacheDir(), cacheName))
}

export function getHostStore(): YamlStore {
  return getStore(join(resolveConfigDir(), HOSTS_FILE))
}

const PROBE_HOST = '__difyctl_probe__'
const PROBE_EMAIL = '__difyctl_probe__'
const PROBE_VALUE = 'probe-v1'

export type GetTokenStoreOptions = {
  readonly factory?: {
    readonly keyring?: () => TokenStore
    readonly file?: () => TokenStore
  }
}

const TOKEN_STORE_OPENERS: Record<StorageMode, (opts: GetTokenStoreOptions) => TokenStore> = {
  file: opts => opts.factory?.file?.() ?? new FileTokenStore(join(resolveConfigDir(), TOKENS_FILE)),
  keychain: opts => opts.factory?.keyring?.() ?? new KeychainTokenStore(KEYRING_SERVICE),
}

/**
 * Decide which credential backend to use by probing the OS keyring with a
 * write/read/remove round-trip. The probe MUTATES the keyring, so call this
 * only where a credential is about to be written anyway (login).
 */
export function detectTokenStore(opts: GetTokenStoreOptions = {}): { store: TokenStore, mode: StorageMode } {
  // DIFY_E2E_NO_KEYRING=1 forces file-based storage in E2E tests to avoid
  // macOS keychain UI prompts blocking child processes spawned by vitest.
  if (process.env.DIFY_E2E_NO_KEYRING === '1')
    return { store: TOKEN_STORE_OPENERS.file(opts), mode: 'file' }
  try {
    const k = TOKEN_STORE_OPENERS.keychain(opts)
    k.write(PROBE_HOST, PROBE_EMAIL, PROBE_VALUE)
    let got = ''
    try {
      got = k.read(PROBE_HOST, PROBE_EMAIL)
    }
    finally {
      k.remove(PROBE_HOST, PROBE_EMAIL)
    }
    if (got === PROBE_VALUE)
      return { store: k, mode: 'keychain' }
  }
  catch { /* keyring unavailable → fall through to file */ }
  return { store: TOKEN_STORE_OPENERS.file(opts), mode: 'file' }
}

/**
 * Construct the credential backend the registry already recorded at login.
 */
export function getTokenStore(mode: StorageMode, opts: GetTokenStoreOptions = {}): TokenStore {
  return TOKEN_STORE_OPENERS[mode](opts)
}
