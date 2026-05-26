import fs from 'node:fs'
import { dirname } from 'node:path'
import yaml from 'js-yaml'
import lockfile from 'lockfile'

const FILE_PERM = 0o600
const DIR_PERM = 0o700

type Key<T> = {
  default: T
  key: string
}

export type Store = {
  get: <T>(key: Key<T>) => T
  set: <T>(key: Key<T>, value: T) => void
}

abstract class FileBasedStore implements Store {
  file_path: string
  raw_content: string | undefined

  constructor(file_path: string) {
    this.file_path = file_path
  }

  protected unlock(): void {
    lockfile.unlockSync(`${this.file_path}.lock`)
  }

  /**
   * atomically write raw_content (if any) and unlock the file
   */
  flush(): void {
    if (this.raw_content !== undefined) {
      const tmp = `${this.file_path}.tmp.${process.pid}.${Date.now()}`
      try {
        fs.writeFileSync(tmp, this.raw_content, { mode: FILE_PERM })
        fs.renameSync(tmp, this.file_path)
      }
      catch (err) {
        try {
          fs.unlinkSync(tmp)
        }
        catch { /* tmp may not exist */ }
        throw err
      }
    }
    lockfile.unlockSync(`${this.file_path}.lock`)
  }

  /**
   * lock and load the file into memory
   */
  load(): void {
    fs.mkdirSync(dirname(this.file_path), { recursive: true, mode: DIR_PERM })
    lockfile.lockSync(`${this.file_path}.lock`)
    this.raw_content = fs.readFileSync(this.file_path, 'utf8')
  }

  // Locks, loads (treating a missing file as empty), runs `body`,
  // and always releases via `release` so callers cannot deadlock.
  private withLock<R>(body: () => R, release: () => void): R {
    try {
      this.load()
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.unlock()
        throw err
      }
      this.raw_content = ''
    }
    try {
      return body()
    }
    finally {
      release()
    }
  }

  get<T>(key: Key<T>): T {
    return this.withLock(() => this.doGet(key), () => this.unlock())
  }

  set<T>(key: Key<T>, value: T) {
    this.withLock(() => this.doSet(key, value), () => this.flush())
  }

  abstract doGet<T>(key: Key<T>): T
  abstract doSet<T>(key: Key<T>, value: T): void
}

export class YamlStore extends FileBasedStore {
  constructor(file_path: string) {
    super(file_path)
  }

  /**
   * get a value from the yaml store and construct a typed value from it
   * @param key path in the yaml
   */
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

  /**
   * Read the whole YAML document and cast it to T. Returns null if the file
   * does not exist yet.
   */
  getTyped<T>(): T | null {
    try {
      this.load()
    }
    catch (err) {
      this.unlock()
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw err
    }
    try {
      return loadYaml(this.raw_content) as T
    }
    finally {
      this.unlock()
    }
  }

  /**
   * Atomically replace the whole YAML document with `data`.
   */
  setTyped<T>(data: T): void {
    fs.mkdirSync(dirname(this.file_path), { recursive: true, mode: DIR_PERM })
    lockfile.lockSync(`${this.file_path}.lock`)
    try {
      this.raw_content = yaml.dump(data, { lineWidth: -1, noRefs: true })
    }
    finally {
      this.flush()
    }
  }

  doSet<T>(key: Key<T>, value: T): void {
    const data = loadYaml(this.raw_content)
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
}

function loadYaml(raw: string | undefined): Record<string, unknown> {
  return (yaml.load(raw ?? '') ?? {}) as Record<string, unknown>
}
