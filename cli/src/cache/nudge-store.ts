import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DIR_PERM, FILE_PERM } from '../config/dir.js'

const CACHE_FILE = 'nudge.json'
const DISK_SCHEMA = 1
export const WARN_INTERVAL_MS = 24 * 60 * 60 * 1000

export type NudgeStore = {
  readonly canWarn: (host: string, now?: Date) => boolean
  readonly markWarned: (host: string, now?: Date) => Promise<void>
}

export type NudgeStoreOptions = {
  readonly configDir: string
  readonly now?: () => Date
  readonly intervalMs?: number
}

type DiskShape = {
  schema?: number
  warned?: Record<string, string>
}

export function nudgeStorePath(configDir: string): string {
  return join(configDir, 'cache', CACHE_FILE)
}

export async function loadNudgeStore(opts: NudgeStoreOptions): Promise<NudgeStore> {
  const path = nudgeStorePath(opts.configDir)
  const intervalMs = opts.intervalMs ?? WARN_INTERVAL_MS
  const clock = opts.now ?? (() => new Date())
  const memory = await readDisk(path)

  return {
    canWarn: (host, now) => {
      const last = memory.get(host)
      if (last === undefined)
        return true
      const elapsed = Math.max(0, (now ?? clock()).getTime() - last)
      return elapsed >= intervalMs
    },
    markWarned: async (host, now) => {
      const stamp = (now ?? clock()).getTime()
      memory.set(host, stamp)
      // Re-read disk inside the write cycle so concurrent processes touching
      // different hosts don't clobber each other's stamps. Same-host writers
      // converge on a near-identical timestamp, so order doesn't matter.
      const onDisk = await readDisk(path)
      onDisk.set(host, stamp)
      await persist(path, onDisk)
    },
  }
}

async function readDisk(path: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return out
    throw err
  }
  let parsed: DiskShape
  try {
    parsed = JSON.parse(raw) as DiskShape
  }
  catch {
    return out
  }
  if (parsed.schema !== DISK_SCHEMA || parsed.warned === undefined)
    return out
  for (const [host, iso] of Object.entries(parsed.warned)) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t))
      out.set(host, t)
  }
  return out
}

async function persist(path: string, state: Map<string, number>): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: DIR_PERM })
  const disk: DiskShape = { schema: DISK_SCHEMA, warned: {} }
  for (const [host, t] of state)
    disk.warned![host] = new Date(t).toISOString()
  // randomUUID is collision-proof even when two writers stamp the same
  // millisecond — pid+timestamp alone can still collide under tight loops.
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(disk), { mode: FILE_PERM })
  await rename(tmp, path)
}
