import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { CompatStatus } from '../version/compat.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DIR_PERM, FILE_PERM } from '../config/dir.js'

const CACHE_FILE = 'compat-snapshot.json'
const DISK_SCHEMA = 1
export const COMPAT_TTL_MS = 24 * 60 * 60 * 1000
export const WARN_SILENCE_MS = 24 * 60 * 60 * 1000

export type CompatSnapshot = {
  readonly host: string
  readonly fetchedAt: string
  readonly lastWarnedAt?: string
  readonly server: ServerVersionResponse
  readonly compat: {
    readonly status: CompatStatus
    readonly detail: string
    readonly minDify: string
    readonly maxDify: string
  }
}

export type CompatSnapshotStore = {
  readonly get: (host: string) => CompatSnapshot | undefined
  readonly set: (snapshot: CompatSnapshot) => Promise<void>
  readonly isFresh: (snapshot: CompatSnapshot, now?: Date) => boolean
  readonly canWarn: (snapshot: CompatSnapshot, now?: Date) => boolean
  readonly markWarned: (host: string, now?: Date) => Promise<void>
}

export type CompatSnapshotStoreOptions = {
  readonly configDir: string
  readonly now?: () => Date
  readonly ttlMs?: number
  readonly silenceMs?: number
}

type DiskShape = {
  schema?: number
  by_host?: Record<string, DiskSnapshot>
}

type DiskSnapshot = {
  host: string
  fetched_at: string
  last_warned_at?: string
  server: ServerVersionResponse
  compat: {
    status: CompatStatus
    detail: string
    min_dify: string
    max_dify: string
  }
}

export function compatSnapshotPath(configDir: string): string {
  return join(configDir, 'cache', CACHE_FILE)
}

export async function loadCompatSnapshotStore(
  opts: CompatSnapshotStoreOptions,
): Promise<CompatSnapshotStore> {
  const path = compatSnapshotPath(opts.configDir)
  const ttlMs = opts.ttlMs ?? COMPAT_TTL_MS
  const silenceMs = opts.silenceMs ?? WARN_SILENCE_MS
  const clock = opts.now ?? (() => new Date())
  const state = new Map<string, CompatSnapshot>()
  await readDisk(path, state)

  return {
    get: host => state.get(host),
    set: async (snapshot) => {
      state.set(snapshot.host, snapshot)
      await persist(path, state)
    },
    isFresh: (snapshot, now) => {
      const elapsed = (now ?? clock()).getTime() - parseIso(snapshot.fetchedAt)
      return elapsed >= 0 && elapsed < ttlMs
    },
    canWarn: (snapshot, now) => {
      if (snapshot.lastWarnedAt === undefined)
        return true
      const elapsed = (now ?? clock()).getTime() - parseIso(snapshot.lastWarnedAt)
      return elapsed >= silenceMs
    },
    markWarned: async (host, now) => {
      const existing = state.get(host)
      if (existing === undefined)
        return
      const stamped = { ...existing, lastWarnedAt: (now ?? clock()).toISOString() }
      state.set(host, stamped)
      await persist(path, state)
    },
  }
}

function parseIso(value: string): number {
  const t = Date.parse(value)
  return Number.isNaN(t) ? 0 : t
}

async function readDisk(path: string, state: Map<string, CompatSnapshot>): Promise<void> {
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
  if (parsed.schema !== DISK_SCHEMA || parsed.by_host === undefined)
    return
  for (const [host, entry] of Object.entries(parsed.by_host))
    state.set(host, fromDisk(entry))
}

function fromDisk(entry: DiskSnapshot): CompatSnapshot {
  return {
    host: entry.host,
    fetchedAt: entry.fetched_at,
    lastWarnedAt: entry.last_warned_at,
    server: entry.server,
    compat: {
      status: entry.compat.status,
      detail: entry.compat.detail,
      minDify: entry.compat.min_dify,
      maxDify: entry.compat.max_dify,
    },
  }
}

function toDisk(snapshot: CompatSnapshot): DiskSnapshot {
  const disk: DiskSnapshot = {
    host: snapshot.host,
    fetched_at: snapshot.fetchedAt,
    server: snapshot.server,
    compat: {
      status: snapshot.compat.status,
      detail: snapshot.compat.detail,
      min_dify: snapshot.compat.minDify,
      max_dify: snapshot.compat.maxDify,
    },
  }
  if (snapshot.lastWarnedAt !== undefined)
    disk.last_warned_at = snapshot.lastWarnedAt
  return disk
}

async function persist(path: string, state: Map<string, CompatSnapshot>): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: DIR_PERM })
  const disk: DiskShape = { schema: DISK_SCHEMA, by_host: {} }
  for (const [host, snapshot] of state)
    disk.by_host![host] = toDisk(snapshot)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(disk), { mode: FILE_PERM })
  await rename(tmp, path)
}
