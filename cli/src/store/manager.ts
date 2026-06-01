import type { Key, StorageMode, Store } from './store'
import { join } from 'node:path'
import { resolveCacheDir, resolveConfigDir } from './dir'
import { KeyringBasedStore, YamlStore } from './store'

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

const PROBE_KEY: Key<string> = { key: '__difyctl_probe__', default: '' }
const PROBE_VALUE = 'probe-v1'

export type GetTokenStoreOptions = {
  readonly factory?: {
    readonly keyring?: () => Store
    readonly file?: () => Store
  }
}

/**
 * Single entry point for the credential store. Probes the OS keyring; if it
 * round-trips a value, returns the keychain-backed store. Otherwise falls
 * back to the YAML file at `<configDir>/tokens.yml`. Both implementations
 * satisfy the `Store` interface, so callers interact uniformly.
 *
 * Business logic should always obtain the token store through this factory
 * rather than constructing one directly.
 */
export function getTokenStore(opts: GetTokenStoreOptions = {}): { store: Store, mode: StorageMode } {
  const fileFactory = opts.factory?.file ?? (() => getStore(join(resolveConfigDir(), TOKENS_FILE)))
  const keyringFactory = opts.factory?.keyring ?? (() => new KeyringBasedStore(KEYRING_SERVICE))
  try {
    const k = keyringFactory()
    k.set(PROBE_KEY, PROBE_VALUE)
    const got = k.get(PROBE_KEY)
    k.unset(PROBE_KEY)
    if (got !== PROBE_VALUE)
      throw new Error('keyring round-trip mismatch')
    return { store: k, mode: 'keychain' }
  }
  catch {
    return { store: fileFactory(), mode: 'file' }
  }
}

/**
 * Maps an auth identity (host + accountId) to a `Store` key. All token store
 * reads/writes in business logic go through this helper so the on-disk /
 * keyring layout stays consistent.
 */
export function tokenKey(host: string, accountId: string): Key<string> {
  return { key: `tokens.${host}.${accountId}`, default: '' }
}
