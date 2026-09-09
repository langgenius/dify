import type { ReactNode } from 'react'
import type { QueryAdapter, UrlChange, UrlOptions } from './adapter'
import { useLayoutEffect, useState } from 'react'
import { QueryStateProvider } from './index'

export type UrlUpdateEvent = {
  searchParams: URLSearchParams
  queryString: string
  options: UrlOptions
}

export function createMemoryQueryAdapter(
  initialUrl = 'http://localhost/',
  onUrlUpdate?: (event: UrlUpdateEvent) => void,
) {
  const entries = [new URL(initialUrl)]
  let index = 0
  const listeners = new Set<(change: UrlChange) => void>()
  const read = () => new URL(entries[index]!)
  const notify = (traversal = false) =>
    listeners.forEach((listener) => listener({ url: read(), traversal }))
  const adapter: QueryAdapter = {
    read,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    write(url, options) {
      if (options.history === 'push') {
        entries.splice(index + 1)
        entries.push(new URL(url))
        index++
      } else entries[index] = new URL(url)
      notify()
      onUrlUpdate?.({
        searchParams: new URLSearchParams(url.searchParams),
        queryString: url.search,
        options,
      })
    },
  }
  return {
    ...adapter,
    navigate(url: string) {
      entries.splice(index + 1)
      entries.push(new URL(url, read()))
      index++
      notify(true)
    },
    back() {
      if (index > 0) {
        index--
        notify(true)
      }
    },
    forward() {
      if (index < entries.length - 1) {
        index++
        notify(true)
      }
    },
  }
}

export function QueryTestingAdapter({
  searchParams = '',
  onUrlUpdate,
  children,
}: {
  searchParams?: string | Record<string, string> | URLSearchParams
  onUrlUpdate?: (event: UrlUpdateEvent) => void
  children: ReactNode
}) {
  const query = new URLSearchParams(searchParams).toString()
  const [session] = useState(() => ({
    initial: query,
    adapter: createMemoryQueryAdapter(`http://localhost/?${query}`, onUrlUpdate),
  }))
  useLayoutEffect(() => {
    if (session.initial !== query) {
      session.initial = query
      session.adapter.navigate(`?${query}`)
    }
  }, [query, session])
  return <QueryStateProvider adapter={session.adapter}>{children}</QueryStateProvider>
}
