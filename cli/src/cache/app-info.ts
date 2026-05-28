import type { AppMeta, AppMetaCacheRecord, AppMetaFieldKey } from '../types/app-meta.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DIR_PERM, FILE_PERM } from '../config/dir.js'
import { FieldInfo, FieldInputSchema, FieldParameters } from '../types/app-meta.js'

const CACHE_FILE = 'app-info.json'
export const APP_INFO_TTL_MS = 60 * 60 * 1000

type DiskShape = {
  entries: Record<string, DiskEntry>
}

type DiskEntry = {
  meta: SerializedMeta
  fetched_at: string
}

type SerializedMeta = {
  info: AppMeta['info']
  parameters: unknown
  input_schema: unknown
  covered_fields: AppMetaFieldKey[]
}

export type AppInfoCache = {
  get: (host: string, appId: string) => AppMetaCacheRecord | undefined
  set: (host: string, appId: string, meta: AppMeta) => Promise<void>
  delete: (host: string, appId: string) => Promise<void>
  isFresh: (record: AppMetaCacheRecord, now?: Date) => boolean
}

type State = {
  entries: Map<string, AppMetaCacheRecord>
}

export type AppInfoCacheOptions = {
  readonly configDir: string
  readonly ttlMs?: number
  readonly now?: () => Date
}

export async function loadAppInfoCache(opts: AppInfoCacheOptions): Promise<AppInfoCache> {
  const path = cachePath(opts.configDir)
  const ttlMs = opts.ttlMs ?? APP_INFO_TTL_MS
  const state: State = { entries: new Map() }
  await readDisk(path, state)
  return {
    get: (host, appId) => state.entries.get(key(host, appId)),
    set: async (host, appId, meta) => {
      const record: AppMetaCacheRecord = { meta, fetchedAt: (opts.now ?? (() => new Date()))().toISOString() }
      state.entries.set(key(host, appId), record)
      await persist(path, state)
    },
    delete: async (host, appId) => {
      state.entries.delete(key(host, appId))
      await persist(path, state)
    },
    isFresh: (record, now) => {
      const t = (now ?? new Date()).getTime() - new Date(record.fetchedAt).getTime()
      return t >= 0 && t < ttlMs
    },
  }
}

export function cachePath(configDir: string): string {
  return join(configDir, 'cache', CACHE_FILE)
}

function key(host: string, appId: string): string {
  return `${host}::${appId}`
}

async function readDisk(path: string, state: State): Promise<void> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return
    throw err
  }
  let parsed: DiskShape
  try {
    parsed = JSON.parse(raw) as DiskShape
  }
  catch {
    return
  }
  if (parsed.entries === undefined)
    return
  for (const [k, e] of Object.entries(parsed.entries)) {
    state.entries.set(k, deserialize(e))
  }
}

function deserialize(e: DiskEntry): AppMetaCacheRecord {
  const covered = new Set<AppMetaFieldKey>(filterFields(e.meta.covered_fields))
  return {
    meta: {
      info: e.meta.info,
      parameters: e.meta.parameters,
      inputSchema: e.meta.input_schema,
      coveredFields: covered,
    },
    fetchedAt: e.fetched_at,
  }
}

function filterFields(input: unknown): AppMetaFieldKey[] {
  if (!Array.isArray(input))
    return []
  const valid = new Set<AppMetaFieldKey>([FieldInfo, FieldParameters, FieldInputSchema])
  return input.filter((s): s is AppMetaFieldKey => typeof s === 'string' && valid.has(s as AppMetaFieldKey))
}

function serialize(record: AppMetaCacheRecord): DiskEntry {
  return {
    meta: {
      info: record.meta.info,
      parameters: record.meta.parameters,
      input_schema: record.meta.inputSchema,
      covered_fields: [...record.meta.coveredFields],
    },
    fetched_at: record.fetchedAt,
  }
}

async function persist(path: string, state: State): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: DIR_PERM })
  const disk: DiskShape = { entries: {} }
  for (const [k, v] of state.entries) disk.entries[k] = serialize(v)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(disk), { mode: FILE_PERM })
  await rename(tmp, path)
}
