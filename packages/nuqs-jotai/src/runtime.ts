import type { createStore } from 'jotai/vanilla'
import type { QueryAdapter, UrlChange, UrlOptions } from './adapter'
import type { OptimisticValue, PreparedEdit, PreparedUpdate, QuerySnapshot } from './query'
import { atom } from 'jotai/vanilla'
import { equalQuery } from './query'

type Store = ReturnType<typeof createStore>
type Waiter = {
  keys: Set<string>
  settled: boolean
  resolve: (search: URLSearchParams) => void
  reject: (error: unknown) => void
}
type PendingEdit = {
  query: PreparedEdit['query']
  local: OptimisticValue
  ownedKeys: Set<string>
  options: UrlOptions
  transitions: Set<NonNullable<PreparedEdit['transition']>>
  // null means the edit has joined the shared throttle batch.
  due: number | null
  waiters: Set<Waiter>
}

function mergeOptions(a: UrlOptions, b: UrlOptions): UrlOptions {
  return {
    history: a.history === 'push' || b.history === 'push' ? 'push' : 'replace',
    shallow: a.shallow && b.shallow,
    scroll: a.scroll || b.scroll,
  }
}

/** One URL owner, typed optimistic snapshot and per-key debounce queues. */
export function createQueryRuntime(adapter: QueryAdapter) {
  let confirmed = adapter.read()
  let snapshot: QuerySnapshot = { href: confirmed.href, values: new Map() }
  const stateAtom = atom(snapshot)
  const errorAtom = atom<unknown>(null)
  const values = new Map<string, OptimisticValue>()
  const pending = new Map<string, PendingEdit>()
  let store: Pick<Store, 'set'> | undefined
  let active = true
  let writingHref: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastWrite = -Infinity
  let throttleDelay = 0

  function applyEdits(url: URL, edits = pending) {
    const next = new URL(url)
    for (const [key, { query }] of edits) {
      next.searchParams.delete(key)
      if (query?.length === 0) next.searchParams.append(key, '')
      else query?.forEach((value) => next.searchParams.append(key, value))
    }
    return next
  }

  function publish() {
    const url = applyEdits(confirmed)
    for (const [key, local] of values) {
      if (!equalQuery(local.query, url.searchParams.getAll(key))) values.delete(key)
    }
    if (
      snapshot.href === url.href &&
      snapshot.values.size === values.size &&
      [...values].every(([key, value]) => snapshot.values.get(key) === value)
    )
      return
    // Publish one immutable snapshot, including same-URL typed updates.
    // Assign before notifying subscribers, which can synchronously write again.
    snapshot = { href: url.href, values: new Map(values) }
    store?.set(stateAtom, snapshot)
  }

  function settle(edits: Map<string, PendingEdit>, url: URL, failure?: { error: unknown }) {
    for (const [key, edit] of edits) {
      for (const waiter of edit.waiters) {
        if (waiter.settled) continue
        waiter.keys.delete(key)
        if (failure || waiter.keys.size === 0) {
          waiter.settled = true
          if (failure) waiter.reject(failure.error)
          else waiter.resolve(new URLSearchParams(url.searchParams))
        }
      }
    }
  }

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    throttleDelay = 0
    const cancelled = new Map(pending)
    pending.clear()
    for (const [key, edit] of cancelled) {
      if (values.get(key) === edit.local) values.delete(key)
    }
    settle(cancelled, adapter.read())
  }

  function receive({ url, traversal }: UrlChange) {
    const previous = confirmed
    confirmed = new URL(url)
    // An own-write echo must not cancel other keys waiting for their debounce.
    if (!traversal && url.href === writingHref) return
    const relevantChange = [...pending.values()].some(({ ownedKeys }) =>
      [...ownedKeys].some(
        (key) => !equalQuery(previous.searchParams.getAll(key), url.searchParams.getAll(key)),
      ),
    )
    if (traversal || url.pathname !== previous.pathname || relevantChange) {
      cancel()
      if (traversal || url.pathname !== previous.pathname) values.clear()
    }
    publish()
  }

  function enqueueThrottle(delay: number) {
    // A finite write resumes an infinite batch; otherwise keep its maximum.
    if (!Number.isFinite(throttleDelay) || delay > throttleDelay) throttleDelay = delay
  }

  function promoteDebounces() {
    for (const edit of pending.values()) {
      if (edit.due !== null && edit.due <= Date.now()) {
        edit.due = null
        enqueueThrottle(0)
      }
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = undefined
    if (!active || pending.size === 0) return
    promoteDebounces()
    let deadline = Infinity
    let ready = false
    for (const edit of pending.values()) {
      if (edit.due === null) ready = true
      else deadline = Math.min(deadline, edit.due)
    }
    if (ready && Number.isFinite(throttleDelay)) {
      deadline = Math.min(
        deadline,
        Math.max(Date.now(), lastWrite + Math.max(adapter.minimumInterval ?? 0, throttleDelay)),
      )
    }
    if (Number.isFinite(deadline)) timer = setTimeout(flush, Math.max(0, deadline - Date.now()))
  }

  function reconcileCommit() {
    receive({ url: adapter.read() })
    publish()
  }

  function flush() {
    timer = undefined
    if (!active || !store || pending.size === 0) return
    const latest = adapter.read()
    if (latest.href !== confirmed.href) receive({ url: latest })
    promoteDebounces()
    const batch = new Map([...pending].filter(([, edit]) => edit.due === null))
    const interval = Math.max(adapter.minimumInterval ?? 0, throttleDelay)
    if (batch.size === 0 || !Number.isFinite(interval) || Date.now() - lastWrite < interval) {
      schedule()
      return
    }
    const next = applyEdits(confirmed, batch)
    let options: UrlOptions = { history: 'replace', shallow: true, scroll: false }
    const transitions = new Set<NonNullable<PreparedEdit['transition']>>()
    for (const [key, edit] of batch) {
      pending.delete(key)
      options = mergeOptions(options, edit.options)
      edit.transitions.forEach((transition) => transitions.add(transition))
    }
    throttleDelay = 0
    writingHref = next.href
    try {
      if (next.href !== confirmed.href || !options.shallow) {
        // Reserve the interval before adapter callbacks can enqueue another write.
        lastWrite = Date.now()
        let commit = () => adapter.write(next, options)
        for (const transition of transitions) {
          const inner = commit
          commit = () => transition(inner)
        }
        commit()
      }
      reconcileCommit()
      store.set(errorAtom, null)
      settle(batch, confirmed)
    } catch (error) {
      // Do not discard a newer value queued by an adapter callback.
      for (const [key, edit] of batch) {
        if (values.get(key) === edit.local) values.delete(key)
      }
      reconcileCommit()
      store.set(errorAtom, error)
      settle(batch, confirmed, { error })
    } finally {
      writingHref = undefined
      schedule()
    }
  }

  return {
    stateAtom,
    errorAtom,
    connect(nextStore: Store) {
      store = nextStore
      const unsubscribe = adapter.subscribe(receive)
      receive({ url: adapter.read() })
      return unsubscribe
    },
    pause() {
      cancel()
      receive({ url: adapter.read() })
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
      const update = prepare()
      if (update.edits.size === 0) return Promise.resolve(new URLSearchParams(latest.searchParams))
      let waiter!: Waiter
      const promise = new Promise<URLSearchParams>((resolve, reject) => {
        waiter = { keys: new Set(update.edits.keys()), settled: false, resolve, reject }
      })
      void promise.catch(() => {})
      const skipped = new Map<string, PendingEdit>()
      for (const [key, edit] of update.edits) {
        const previous = pending.get(key)
        const local = {
          query: edit.query === null ? [] : edit.query.length === 0 ? [''] : edit.query,
          value: edit.value,
        }
        // A restarted debounce takes the latest call's options. A throttle
        // batch retains stronger options from every write it has accepted.
        const batched = previous?.due === null && !edit.debounce
        const transitions = new Set(batched ? previous.transitions : undefined)
        if (edit.transition) transitions.add(edit.transition)
        const entry: PendingEdit = {
          query: edit.query,
          local,
          ownedKeys: new Set([...(previous?.ownedKeys ?? []), ...update.keys]),
          options: batched ? mergeOptions(previous.options, edit.options) : edit.options,
          transitions,
          due: edit.debounce ? Date.now() + edit.delay : null,
          waiters: new Set([...(previous?.waiters ?? []), waiter]),
        }
        pending.set(key, entry)
        values.set(key, local)
        if (!edit.debounce) enqueueThrottle(edit.delay)
        if (!Number.isFinite(edit.delay)) skipped.set(key, entry)
      }
      if (![...pending.values()].some((edit) => edit.due === null)) throttleDelay = 0
      settle(skipped, latest)
      // Schedule before publishing: subscribers may cancel or replace this work.
      schedule()
      publish()
      store.set(errorAtom, null)
      return promise
    },
  }
}
