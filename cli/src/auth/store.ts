import { FileBackend } from './file-backend.js'
import { KeyringBackend } from './keyring-backend.js'

export type TokenStore = {
  put: (host: string, accountId: string, token: string) => Promise<void>
  get: (host: string, accountId: string) => Promise<string | undefined>
  delete: (host: string, accountId: string) => Promise<void>
  list: (host: string) => Promise<readonly string[]>
}

export type StorageMode = 'keychain' | 'file'

export type SelectStoreOptions = {
  readonly configDir: string
  readonly factory?: {
    readonly keyring?: () => TokenStore
    readonly file?: (dir: string) => TokenStore
  }
}

const PROBE_HOST = '__difyctl_probe__'
const PROBE_ACCOUNT = '__probe__'
const PROBE_VALUE = 'probe-v1'

export async function selectStore(opts: SelectStoreOptions): Promise<{ store: TokenStore, mode: StorageMode }> {
  const fileFactory = opts.factory?.file ?? ((dir: string) => new FileBackend(dir))
  const keyringFactory = opts.factory?.keyring ?? (() => new KeyringBackend())
  try {
    const k = keyringFactory()
    await k.put(PROBE_HOST, PROBE_ACCOUNT, PROBE_VALUE)
    const got = await k.get(PROBE_HOST, PROBE_ACCOUNT)
    await k.delete(PROBE_HOST, PROBE_ACCOUNT)
    if (got !== PROBE_VALUE)
      throw new Error('keyring round-trip mismatch')
    return { store: k, mode: 'keychain' }
  }
  catch {
    return { store: fileFactory(opts.configDir), mode: 'file' }
  }
}
