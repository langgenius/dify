import type { createStore } from 'jotai/vanilla'
import type { QueryAdapter, UrlChange, UrlOptions } from './adapter'
import type { PreparedUpdate } from './query'
import { atom } from 'jotai/vanilla'

type Store = ReturnType<typeof createStore>
type Waiter = {
  resolve: (search: URLSearchParams) => void
  reject: (error: unknown) => void
}

/** One URL owner and queue, shared by every query atom under the provider. */
export function createQueryRuntime(adapter: QueryAdapter) {
  let confirmed = adapter.read()
  const stateAtom = atom(confirmed.href)
  const errorAtom = atom<unknown>(null)
  let store: Pick<Store, 'set'> | undefined
  let active = true
  let writing = false
  let connection = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let scheduledAt = Infinity
  let scheduledDebounce = false
  let lastWrite = -Infinity
  let pending = new Map<string, string[] | null>()
  let ownedKeys = new Set<string>()
  let pendingPath: string | undefined
  let waiters: Waiter[] = []
  let commitOptions: UrlOptions = { history: 'replace', shallow: true, scroll: false }

  function applyPending(url: URL) {
    const next = new URL(url)
    for (const [key, values] of pending) {
      next.searchParams.delete(key)
      values?.forEach((value) => next.searchParams.append(key, value))
    }
    return next
  }

  function publish(url: URL) {
    store?.set(stateAtom, url.href)
  }

  function reset() {
    clearTimeout(timer)
    timer = undefined
    scheduledAt = Infinity
    scheduledDebounce = false
    pending = new Map()
    ownedKeys = new Set()
    pendingPath = undefined
    commitOptions = { history: 'replace', shallow: true, scroll: false }
    const settled = waiters
    waiters = []
    return settled
  }

  function cancel() {
    const url = adapter.read()
    reset().forEach(({ resolve }) => resolve(new URLSearchParams(url.searchParams)))
  }

  function receive({ url, traversal }: UrlChange) {
    const previous = confirmed
    confirmed = new URL(url)
    if (writing) return
    const relevantChange = [...ownedKeys].some(
      (key) =>
        JSON.stringify(previous.searchParams.getAll(key)) !==
        JSON.stringify(url.searchParams.getAll(key)),
    )
    if (traversal || url.pathname !== previous.pathname || relevantChange) {
      cancel()
      publish(url)
    } else {
      // Other owners can change unrelated parameters while a draft is pending.
      publish(applyPending(url))
    }
  }

  function flush() {
    timer = undefined
    if (!active || !store || pending.size === 0) return
    const latest = adapter.read()
    if (latest.pathname !== pendingPath) {
      receive({ url: latest, traversal: true })
      return
    }
    const next = applyPending(latest)
    const options = commitOptions
    const settled = reset()
    writing = true
    try {
      if (next.href !== latest.href) {
        adapter.write(next, options)
        lastWrite = Date.now()
      }
      confirmed = adapter.read()
      // Adapter callbacks may have queued a new draft during this commit.
      publish(applyPending(confirmed))
      store.set(errorAtom, null)
      settled.forEach(({ resolve }) => resolve(new URLSearchParams(confirmed.searchParams)))
    } catch (error) {
      confirmed = adapter.read()
      // Adapter callbacks may have queued a new draft during this commit.
      publish(applyPending(confirmed))
      store.set(errorAtom, error)
      settled.forEach(({ reject }) => reject(error))
    } finally {
      writing = false
    }
  }

  return {
    stateAtom,
    errorAtom,
    connect(nextStore: Store) {
      const version = ++connection
      store = nextStore
      active = true
      const unsubscribe = adapter.subscribe(receive)
      receive({ url: adapter.read() })
      return () => {
        unsubscribe()
        // StrictMode reconnects before this microtask. A detached provider
        // does not, and must not leave delayed writes behind.
        queueMicrotask(() => {
          if (connection !== version) return
          active = false
          cancel()
        })
      }
    },
    dispose() {
      active = false
      cancel()
    },
    write(prepare: () => PreparedUpdate, access: Pick<Store, 'set'>) {
      store ??= access
      if (!active)
        throw new Error('[nuqs-jotai] Cannot update query atoms outside their mounted provider')
      const latest = adapter.read()
      if (latest.href !== confirmed.href) receive({ url: latest })
      // Functional updates must read the reconciled snapshot before serialization.
      const update = prepare()
      if (update.edits.size === 0) return Promise.resolve(new URLSearchParams(latest.searchParams))
      update.edits.forEach((value, key) => pending.set(key, value))
      update.keys.forEach((key) => ownedKeys.add(key))
      pendingPath = latest.pathname
      if (update.options.history === 'push') commitOptions.history = 'push'
      if (!update.options.shallow) commitOptions.shallow = false
      if (update.options.scroll) commitOptions.scroll = true
      const promise = new Promise<URLSearchParams>((resolve, reject) =>
        waiters.push({ resolve, reject }),
      )
      // Fire-and-forget callers use errorAtom; awaiting still propagates failure.
      void promise.catch(() => {})
      const minimum = Math.max(0, (adapter.minimumInterval ?? 0) - (Date.now() - lastWrite))
      const debounced = update.debounce && !update.immediate && commitOptions.history !== 'push'
      const delay = Math.max(minimum, update.throttleDelay, debounced ? update.debounceDelay : 0)
      const deadline = Date.now() + delay
      const reschedule =
        timer === undefined || (debounced ? scheduledDebounce : deadline < scheduledAt)
      // Once an immediate/throttled action joins the batch, subsequent updates
      // may advance its deadline but must never postpone it, including typing.
      if (!debounced) scheduledDebounce = false
      if (reschedule) {
        clearTimeout(timer)
        scheduledAt = deadline
        scheduledDebounce = debounced
        timer = setTimeout(flush, delay)
      }
      // Register and schedule before publishing: synchronous subscribers may
      // cancel this batch or start a new one. No old scheduling may follow them.
      publish(applyPending(latest))
      store.set(errorAtom, null)
      return promise
    },
  }
}
