import type { Store } from '@/store/store'
import { CACHE_COMPAT, getCache } from '@/store/manager'

// How long a host stays "known compatible" before difyctl re-probes /_version.
export const COMPAT_TTL_MS = 60 * 60 * 1000

// Only *positive* (compatible) verdicts are cached — never "too old". A host that
// was too old is re-probed every time, so a just-upgraded server clears a previous
// block immediately instead of staying locked out for the whole TTL.
const COMPATIBLE_KEY = { key: 'compatible', default: {} as Record<string, string> } as const

export type CompatStore = {
  readonly isFreshCompatible: (host: string, now?: Date) => boolean
  readonly markCompatible: (host: string, now?: Date) => Promise<void>
}

export type CompatStoreOptions = {
  readonly store?: Store
  readonly now?: () => Date
  readonly ttlMs?: number
}

export async function loadCompatStore(opts: CompatStoreOptions = {}): Promise<CompatStore> {
  const store = opts.store ?? getCache(CACHE_COMPAT)
  const ttlMs = opts.ttlMs ?? COMPAT_TTL_MS
  const clock = opts.now ?? (() => new Date())
  const memory = await readCompatible(store)

  return {
    isFreshCompatible: (host, now) => {
      const last = memory.get(host)
      if (last === undefined)
        return false
      const elapsed = Math.max(0, (now ?? clock()).getTime() - last)
      return elapsed < ttlMs
    },
    markCompatible: async (host, now) => {
      const stamp = (now ?? clock()).getTime()
      memory.set(host, stamp)
      // Re-read disk inside the write cycle so concurrent processes touching
      // different hosts don't clobber each other's stamps.
      const onDisk = await readCompatible(store)
      onDisk.set(host, stamp)
      await writeCompatible(store, onDisk)
    },
  }
}

async function readCompatible(store: Store): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  let raw: Record<string, string>
  try {
    raw = await store.get(COMPATIBLE_KEY)
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

async function writeCompatible(store: Store, state: Map<string, number>): Promise<void> {
  const compatible: Record<string, string> = {}
  for (const [host, t] of state)
    compatible[host] = new Date(t).toISOString()
  await store.set(COMPATIBLE_KEY, compatible)
}
