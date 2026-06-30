import type { Options as LockOptions } from 'lockfile'
import type { Platform } from '@/sys'
import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import { AsyncEntry } from '@napi-rs/keyring'
import yaml from 'js-yaml'
import lockfile from 'lockfile'
import { pid, resolvePlatform } from '@/sys'
import { BadYamlFormatError, ConcurrentAccessError } from './errors'

const FILE_PERM = 0o600
const DIR_PERM = 0o700
const LOCK_STALE_MS = 30_000

function lockAsync(path: string, opts: LockOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    lockfile.lock(path, opts, err => (err ? reject(err) : resolve()))
  })
}

function unlockAsync(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    lockfile.unlock(path, err => (err ? reject(err) : resolve()))
  })
}

export type Key<T> = {
  default: T
  key: string
}

export type Store = {
  get: <T>(key: Key<T>) => Promise<T>
  set: <T>(key: Key<T>, value: T) => Promise<void>
  unset: <T>(key: Key<T>) => Promise<void>
}

export const STORAGE_MODES = ['keychain', 'file'] as const
export type StorageMode = typeof STORAGE_MODES[number]

abstract class FileBasedStore implements Store {
  filePath: string
  private rawContent: string | undefined
  private readonly platform: Platform
  private dirty: boolean = false

  constructor(filePath: string) {
    this.filePath = filePath
    this.platform = resolvePlatform()
  }

  private async ensureDir(): Promise<void> {
    await fsp.mkdir(dirname(this.filePath), { recursive: true, mode: DIR_PERM })
  }

  async unlock(): Promise<void> {
    await unlockAsync(`${this.filePath}.lock`)
  }

  /**
   * atomically write raw_content (if any)
   */
  async flush(): Promise<void> {
    // we don't handle A-B-A scenario,
    // which is not likely to happen in cli
    if (!this.dirty) {
      return
    }

    if (this.rawContent !== undefined) {
      await this.ensureDir()
      const tmp = `${this.filePath}.tmp.${pid()}.${Date.now()}`
      try {
        await fsp.writeFile(tmp, this.rawContent, { mode: FILE_PERM })
        this.platform.atomicReplace(tmp, this.filePath)
      }
      catch (err) {
        try {
          await fsp.unlink(tmp)
        }
        catch { /* tmp may not exist */ }
        throw err
      }
    }

    this.dirty = false
  }

  async lock(): Promise<void> {
    await this.ensureDir()
    try {
      await lockAsync(`${this.filePath}.lock`, {
        stale: LOCK_STALE_MS,
      })
    }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        throw new ConcurrentAccessError(this.filePath)
      }
      throw err
    }
  }

  async load(): Promise<void> {
    try {
      this.rawContent = await fsp.readFile(this.filePath, 'utf8')
      this.dirty = false
    }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw err
      }
    }
  }

  public setRawContent(content: string): void {
    this.dirty = (content !== this.getRawContent())
    this.rawContent = content
  }

  public getRawContent(): string | undefined {
    return this.rawContent
  }

  protected async withLock<R>(body: () => R | Promise<R>): Promise<R> {
    await this.lock()
    try {
      return await body()
    }
    finally {
      await this.unlock()
    }
  }

  async get<T>(key: Key<T>): Promise<T> {
    return this.withLock(async () => {
      await this.load()
      return this.doGet(key)
    })
  }

  async set<T>(key: Key<T>, value: T): Promise<void> {
    await this.withLock(async () => {
      await this.load()
      this.doSet(key, value)
      await this.flush()
    })
  }

  async unset<T>(key: Key<T>): Promise<void> {
    await this.withLock(async () => {
      await this.load()
      this.doUnset(key)
      await this.flush()
    })
  }

  /**
   * Remove the underlying file of the store. No-op if file doesn't exist.
   */
  async rm(): Promise<void> {
    try {
      await fsp.unlink(this.filePath)
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        throw err
    }
  }

  abstract doGet<T>(key: Key<T>): T
  abstract doSet<T>(key: Key<T>, value: T): void
  abstract doUnset<T>(key: Key<T>): void
}

export class YamlStore extends FileBasedStore {
  constructor(file_path: string) {
    super(file_path)
  }

  doGet<T>(key: Key<T>): T {
    const data = loadYaml(this.getRawContent(), this.filePath)
    const parts = key.key.split('.')
    let current: unknown = data
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object')
        return key.default
      current = (current as Record<string, unknown>)[part]
    }
    return (current as T) ?? key.default
  }

  async getTyped<T>(): Promise<T | null> {
    return this.withLock(async () => {
      await this.load()
      return loadYaml(this.getRawContent(), this.filePath) as T
    })
  }

  async setTyped<T>(data: T): Promise<void> {
    await this.withLock(async () => {
      await this.load()
      this.setRawContent(yaml.dump(data, { lineWidth: -1, noRefs: true }))
      await this.flush()
    })
  }

  doSet<T>(key: Key<T>, value: T): void {
    const data = loadYaml(this.getRawContent(), this.filePath) || {}
    const parts = key.key.split('.')
    const lastKey = parts.pop()
    if (lastKey === undefined)
      return
    let current: Record<string, unknown> = data
    for (const part of parts) {
      if (current[part] === null || current[part] === undefined || typeof current[part] !== 'object')
        current[part] = {}
      current = current[part] as Record<string, unknown>
    }
    current[lastKey] = value
    this.setRawContent(yaml.dump(data, { lineWidth: -1, noRefs: true }))
  }

  doUnset<T>(key: Key<T>): void {
    const data = loadYaml(this.getRawContent(), this.filePath) || {}
    const parts = key.key.split('.')
    const lastKey = parts.pop()
    if (lastKey === undefined)
      return
    let current: Record<string, unknown> = data
    for (const part of parts) {
      const next = current[part]
      if (next === null || next === undefined || typeof next !== 'object')
        return
      current = next as Record<string, unknown>
    }
    if (!(lastKey in current))
      return
    delete current[lastKey]
    this.setRawContent(yaml.dump(data, { lineWidth: -1, noRefs: true }))
  }
}

function loadYaml(raw: string | undefined, file_path: string): Record<string, unknown> | null {
  if (raw === undefined)
    return null
  try {
    return (yaml.load(raw) ?? {}) as Record<string, unknown>
  }
  catch (err) {
    if (err instanceof yaml.YAMLException)
      throw new BadYamlFormatError(file_path, raw, err)
    throw err
  }
}

/**
 * OS-keyring-based storage primitive. Sits at the same layer as
 * `FileBasedStore`: implements `Store` with each `Key<T>` corresponding to a
 * single keyring entry under the configured service. Values are JSON-encoded.
 */
export class KeyringBasedStore implements Store {
  private readonly service: string

  constructor(service: string) {
    this.service = service
  }

  async get<T>(key: Key<T>): Promise<T> {
    try {
      const v = await new AsyncEntry(this.service, key.key).getPassword()
      if (v === null || v === undefined || v === '')
        return key.default
      return JSON.parse(v) as T
    }
    catch {
      return key.default
    }
  }

  async set<T>(key: Key<T>, value: T): Promise<void> {
    await new AsyncEntry(this.service, key.key).setPassword(JSON.stringify(value))
  }

  async unset<T>(key: Key<T>): Promise<void> {
    try {
      await new AsyncEntry(this.service, key.key).deletePassword()
    }
    catch { /* missing entry is fine */ }
  }
}
