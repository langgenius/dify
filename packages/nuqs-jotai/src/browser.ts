import type { QueryAdapter, UrlChange } from './adapter'

type Listener = (change: UrlChange) => void
const observers = new WeakMap<Window, Set<Listener>>()

function observeBrowser(listener: Listener) {
  let listeners = observers.get(window)
  if (!listeners) {
    listeners = new Set()
    observers.set(window, listeners)
    const subscribers = listeners
    const notify = (traversal = false) => {
      const change = { url: new URL(window.location.href), traversal }
      subscribers.forEach((callback) => callback(change))
    }
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = window.history[method]
      window.history[method] = function (data, unused, url) {
        const before = window.location.href
        original.call(this, data, unused, url)
        // Frameworks also replace history state without changing the address.
        if (window.location.href !== before) {
          // Next may commit history from an insertion effect. Notify atom
          // subscribers after that commit, using the latest browser snapshot.
          queueMicrotask(() => notify())
        }
      }
    }
    window.addEventListener('popstate', () => notify(true))
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Native history writes coexist with other owners; only the requested keys change. */
export function createBrowserQueryAdapter({
  initialUrl,
  refresh,
}: {
  initialUrl: URL
  refresh: (url: URL) => void
}): QueryAdapter & { notifyUrlChange: (traversal?: boolean) => void } {
  const listeners = new Set<Listener>()
  return {
    read: () =>
      typeof window === 'undefined' ? new URL(initialUrl) : new URL(window.location.href),
    subscribe(listener) {
      listeners.add(listener)
      const unsubscribe = observeBrowser(listener)
      return () => {
        listeners.delete(listener)
        unsubscribe()
      }
    },
    notifyUrlChange(traversal = false) {
      const change = { url: new URL(window.location.href), traversal }
      listeners.forEach((listener) => listener(change))
    },
    // Allow room for the history calls made by the router as well as our write.
    minimumInterval: 400,
    write(url, options) {
      const method = options.history === 'push' ? 'pushState' : 'replaceState'
      // Let the framework history wrapper attach its router metadata and
      // update useSearchParams; passing its internal state can bypass that wrapper.
      window.history[method](null, '', url)
      if (options.scroll) window.scrollTo(0, 0)
      if (!options.shallow) refresh(url)
    },
  }
}
