import type { Store } from '@/store/store'
import type { AppMeta, AppMetaCacheRecord, AppMetaFieldKey } from '@/types/app-meta'
import { CACHE_APP_INFO, getCache } from '@/store/manager'
import { FieldInfo, FieldInputSchema, FieldParameters } from '@/types/app-meta'

export const APP_INFO_TTL_MS = 60 * 60 * 1000

// All entries live under one top-level key; the inner record uses
// `host::appId` composites that contain `::` (never `.`), so they're
// safe as map keys without colliding with Store's dot-path semantics.
const ENTRIES_KEY = { key: 'entries', default: {} as Record<string, DiskEntry> } as const

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
  readonly store?: Store
  readonly ttlMs?: number
  readonly now?: () => Date
}

export async function loadAppInfoCache(opts: AppInfoCacheOptions = {}): Promise<AppInfoCache> {
  const store = opts.store ?? getCache(CACHE_APP_INFO)
  const ttlMs = opts.ttlMs ?? APP_INFO_TTL_MS
  const state: State = { entries: await readEntries(store) }
  return {
    get: (host, appId) => state.entries.get(key(host, appId)),
    set: async (host, appId, meta) => {
      const record: AppMetaCacheRecord = {
        meta,
        fetchedAt: (opts.now ?? (() => new Date()))().toISOString(),
      }
      state.entries.set(key(host, appId), record)
      await writeEntries(store, state.entries)
    },
    delete: async (host, appId) => {
      state.entries.delete(key(host, appId))
      await writeEntries(store, state.entries)
    },
    isFresh: (record, now) => {
      const t = (now ?? new Date()).getTime() - new Date(record.fetchedAt).getTime()
      return t >= 0 && t < ttlMs
    },
  }
}

function key(host: string, appId: string): string {
  return `${host}::${appId}`
}

async function readEntries(store: Store): Promise<Map<string, AppMetaCacheRecord>> {
  const out = new Map<string, AppMetaCacheRecord>()
  let raw: Record<string, DiskEntry>
  try {
    raw = await store.get(ENTRIES_KEY)
  } catch {
    return out
  }
  // A scalar/array survives Object.entries as garbage rather than throwing.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out

  for (const [k, e] of Object.entries(raw)) {
    try {
      out.set(k, deserialize(e))
    } catch {
      // Drop unreadable entry → becomes a cache miss → consumer refetches.
    }
  }
  return out
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
  if (!Array.isArray(input)) return []
  const valid = new Set<AppMetaFieldKey>([FieldInfo, FieldParameters, FieldInputSchema])
  return input.filter(
    (s): s is AppMetaFieldKey => typeof s === 'string' && valid.has(s as AppMetaFieldKey),
  )
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

async function writeEntries(store: Store, entries: Map<string, AppMetaCacheRecord>): Promise<void> {
  const out: Record<string, DiskEntry> = {}
  for (const [k, v] of entries) out[k] = serialize(v)
  await store.set(ENTRIES_KEY, out)
}
