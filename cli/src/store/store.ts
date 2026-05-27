import type { Platform } from '../sys'
import fs from 'node:fs'
import { dirname } from 'node:path'
import { Entry } from '@napi-rs/keyring'
import yaml from 'js-yaml'
import lockfile from 'lockfile'
import { pid, resolvePlatform } from '../sys'

const FILE_PERM = 0o600
const DIR_PERM = 0o700

export type Key<T> = {
  default: T
  key: string
}

export type Store = {
  get: <T>(key: Key<T>) => T
  set: <T>(key: Key<T>, value: T) => void
  unset: <T>(key: Key<T>) => void
}

export type StorageMode = 'keychain' | 'file'

export class ConcurrentAccessError extends Error {
  constructor(filePath: string) {
    super(`Another process is modifying the file ${filePath}. remove ${filePath}.lock to reset lock.`)
  }
}

abstract class FileBasedStore implements Store {
  file_path: string
  raw_content: string | undefined
  private readonly platform: Platform

  constructor(file_path: string) {
    this.file_path = file_path
    this.platform = resolvePlatform()
    fs.mkdirSync(dirname(this.file_path), { recursive: true, mode: DIR_PERM })
  }

  unlock(): void {
    lockfile.unlockSync(`${this.file_path}.lock`)
  }

  /**
   * atomically write raw_content (if any)
   */
  flush(): void {
    if (this.raw_content !== undefined) {
      const tmp = `${this.file_path}.tmp.${pid()}.${Date.now()}`
      try {
        fs.writeFileSync(tmp, this.raw_content, { mode: FILE_PERM })
        this.platform.atomicReplace(tmp, this.file_path)
      }
      catch (err) {
        try {
          fs.unlinkSync(tmp)
        }
        catch { /* tmp may not exist */ }
        throw err
      }
    }
  }

  lock(): void {
    try {
      lockfile.lockSync(`${this.file_path}.lock`)
    }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        throw new ConcurrentAccessError(this.file_path)
      }
      throw err
    }
  }

  load(): void {
    try {
      this.raw_content = fs.readFileSync(this.file_path, 'utf8')
    }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw err
      }
    }
  }

  protected withLock<R>(body: () => R): R {
    this.lock()
    try {
      this.load()
      return body()
    }
    finally {
      this.unlock()
    }
  }

  get<T>(key: Key<T>): T {
    return this.withLock(() => this.doGet(key))
  }

  set<T>(key: Key<T>, value: T) {
    this.withLock(() => {
      this.doSet(key, value)
      this.flush()
    })
  }

  unset<T>(key: Key<T>): void {
    this.withLock(() => {
      this.doUnset(key)
      this.flush()
    })
  }

  /**
   * Remove the underlying file of the store. No-op if file doesn't exist.
   */
  rm(): void {
    try {
      fs.unlinkSync(this.file_path)
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
    const data = loadYaml(this.raw_content)
    const parts = key.key.split('.')
    let current: unknown = data
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object')
        return key.default
      current = (current as Record<string, unknown>)[part]
    }
    return (current as T) ?? key.default
  }

  getTyped<T>(): T | null {
    return this.withLock(() => {
      this.load()
      return loadYaml(this.raw_content) as T
    })
  }

  setTyped<T>(data: T): void {
    this.withLock(() => {
      this.raw_content = yaml.dump(data, { lineWidth: -1, noRefs: true })
      this.flush()
    })
  }

  doSet<T>(key: Key<T>, value: T): void {
    const data = loadYaml(this.raw_content) || {}
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
    this.raw_content = yaml.dump(data, { lineWidth: -1, noRefs: true })
  }

  doUnset<T>(key: Key<T>): void {
    const data = loadYaml(this.raw_content) || {}
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
    this.raw_content = yaml.dump(data, { lineWidth: -1, noRefs: true })
  }
}

function loadYaml(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined)
    return null
  return (yaml.load(raw) ?? {}) as Record<string, unknown>
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

  get<T>(key: Key<T>): T {
    try {
      const v = new Entry(this.service, key.key).getPassword()
      if (v === null || v === undefined || v === '')
        return key.default
      return JSON.parse(v) as T
    }
    catch {
      return key.default
    }
  }

  set<T>(key: Key<T>, value: T): void {
    new Entry(this.service, key.key).setPassword(JSON.stringify(value))
  }

  unset<T>(key: Key<T>): void {
    try {
      new Entry(this.service, key.key).deletePassword()
    }
    catch { /* missing entry is fine */ }
  }
}
