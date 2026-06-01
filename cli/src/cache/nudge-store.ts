import type { Store } from '@/store/store'
import { CACHE_NUDGE, getCache } from '@/store/manager'

export const WARN_INTERVAL_MS = 24 * 60 * 60 * 1000

// Single top-level key holding host→ISO map. Hosts contain dots
// (cloud.dify.ai), so we cannot use them as Store paths directly —
// `doSet` would split on dots and create nested objects.
const WARNED_KEY = { key: 'warned', default: {} as Record<string, string> } as const

export type NudgeStore = {
  readonly canWarn: (host: string, now?: Date) => boolean
  readonly markWarned: (host: string, now?: Date) => Promise<void>
}

export type NudgeStoreOptions = {
  readonly store?: Store
  readonly now?: () => Date
  readonly intervalMs?: number
}

export async function loadNudgeStore(opts: NudgeStoreOptions = {}): Promise<NudgeStore> {
  const store = opts.store ?? getCache(CACHE_NUDGE)
  const intervalMs = opts.intervalMs ?? WARN_INTERVAL_MS
  const clock = opts.now ?? (() => new Date())
  const memory = readWarned(store)

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
      const onDisk = readWarned(store)
      onDisk.set(host, stamp)
      writeWarned(store, onDisk)
    },
  }
}

function readWarned(store: Store): Map<string, number> {
  const out = new Map<string, number>()
  let raw: Record<string, string>
  try {
    raw = store.get(WARNED_KEY)
  }
  catch {
    return out
  }
  for (const [host, iso] of Object.entries(raw)) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t))
      out.set(host, t)
  }
  return out
}

function writeWarned(store: Store, state: Map<string, number>): void {
  const warned: Record<string, string> = {}
  for (const [host, t] of state)
    warned[host] = new Date(t).toISOString()
  store.set(WARNED_KEY, warned)
}
