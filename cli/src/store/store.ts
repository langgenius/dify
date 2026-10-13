import type { Options as LockOptions } from 'lockfile'
import type { Platform } from '@/sys'
import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import {
  binaryTag,
  CORE_SCHEMA,
  dump,
  loadAll,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
  YAMLException,
} from 'js-yaml'
import lockfile from 'lockfile'
import { pid, resolvePlatform } from '@/sys'
import { DIR_PERM, FILE_PERM } from './dir'
import { BadYamlFormatError, ConcurrentAccessError } from './errors'

const LOCK_STALE_MS = 30_000
// Parallel difyctl runs (an agent's usual case) wait their turn instead of failing.
const LOCK_WAIT_MS = 5_000
const YAML_LOAD_SCHEMA = CORE_SCHEMA.withTags(
  binaryTag,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
)

function lockAsync(path: string, opts: LockOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    lockfile.lock(path, opts, (err) => (err ? reject(err) : resolve()))
  })
}

function unlockAsync(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    lockfile.unlock(path, (err) => (err ? reject(err) : resolve()))
  })
}

export const STORAGE_MODES = ['keychain', 'file'] as const
export type StorageMode = (typeof STORAGE_MODES)[number]

export class YamlStore {
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
      } catch (err) {
        try {
          await fsp.unlink(tmp)
        } catch {
          /* tmp may not exist */
        }
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
        wait: LOCK_WAIT_MS,
      })
    } catch (err) {
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
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw err
      }
      this.rawContent = undefined
    }
  }

  public setRawContent(content: string): void {
    this.dirty = content !== this.getRawContent()
    this.rawContent = content
  }

  public getRawContent(): string | undefined {
    return this.rawContent
  }

  private async withLock<R>(body: () => R | Promise<R>): Promise<R> {
    await this.lock()
    try {
      return await body()
    } finally {
      await this.unlock()
    }
  }

  /**
   * Remove the underlying file of the store. No-op if file doesn't exist.
   */
  async rm(): Promise<void> {
    try {
      await fsp.unlink(this.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
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
      this.setRawContent(dump(data, { lineWidth: -1, noRefs: true }))
      await this.flush()
    })
  }
}

function loadYaml(raw: string | undefined, file_path: string): Record<string, unknown> | null {
  if (raw === undefined) return null
  try {
    const documents = loadAll(raw, { schema: YAML_LOAD_SCHEMA })
    if (documents.length > 1)
      throw new YAMLException('expected a single document in the stream, but found more')
    return (documents[0] ?? {}) as Record<string, unknown>
  } catch (err) {
    if (err instanceof YAMLException) throw new BadYamlFormatError(file_path, raw, err)
    throw err
  }
}
