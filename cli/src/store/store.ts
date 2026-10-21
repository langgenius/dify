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

/** What an update returns to delete the file. */
export const REMOVE = Symbol('remove')

/** The next document, REMOVE to delete the file, or undefined to leave the file as it is. */
export type Change<T> = T | typeof REMOVE | undefined

export class YamlStore {
  private readonly filePath: string
  private readonly platform: Platform

  constructor(filePath: string) {
    this.filePath = filePath
    this.platform = resolvePlatform()
  }

  async read(): Promise<string | undefined> {
    return this.withLock(() => this.load())
  }

  /**
   * Read, change and write the file under one lock, so a change made by another
   * process in between is never lost. `change` is sync: an async one could hold the
   * lock past LOCK_STALE_MS, and another process would then take it.
   */
  async update<T>(change: (content: string | undefined) => Change<T>): Promise<void> {
    await this.withLock(async () => {
      const content = await this.load()
      const next = change(content)
      if (next === undefined) return
      if (next === REMOVE) return this.rm()
      const dumped = dump(next, { lineWidth: -1, noRefs: true })
      if (dumped !== content) await this.replace(dumped)
    })
  }

  private async withLock<R>(body: () => Promise<R>): Promise<R> {
    await this.lock()
    try {
      return await body()
    } finally {
      await unlockAsync(`${this.filePath}.lock`)
    }
  }

  private async lock(): Promise<void> {
    await fsp.mkdir(dirname(this.filePath), { recursive: true, mode: DIR_PERM })
    try {
      await lockAsync(`${this.filePath}.lock`, {
        stale: LOCK_STALE_MS,
        wait: LOCK_WAIT_MS,
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST')
        throw new ConcurrentAccessError(this.filePath)
      throw err
    }
  }

  private async load(): Promise<string | undefined> {
    try {
      return await fsp.readFile(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
  }

  private async replace(content: string): Promise<void> {
    const tmp = `${this.filePath}.tmp.${pid()}.${Date.now()}`
    try {
      await fsp.writeFile(tmp, content, { mode: FILE_PERM })
      this.platform.atomicReplace(tmp, this.filePath)
    } catch (err) {
      await fsp.unlink(tmp).catch(() => undefined)
      throw err
    }
  }

  private async rm(): Promise<void> {
    try {
      await fsp.unlink(this.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
}

export function loadYaml(
  raw: string | undefined,
  file_path: string,
): Record<string, unknown> | null {
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
