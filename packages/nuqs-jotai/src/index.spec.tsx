import type { UrlUpdateEvent } from './testing'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { debounce, parseAsInteger, throttle } from 'nuqs'
import { Activity, StrictMode, Suspense, useLayoutEffect, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test'
import { createBrowserQueryAdapter } from './browser'
import {
  atomsWithSearchParams,
  atomWithSearchParam,
  atomWithSearchParams,
  queryStateErrorAtom,
  QueryStateProvider,
} from './index'
import { createMemoryQueryAdapter, QueryTestingAdapter } from './testing'

const pageAtom = atomWithSearchParam('page', parseAsInteger.withDefault(1), {
  debugLabel: 'pagination',
})

function PageButton({ label }: { label: string }) {
  const [page, setPage] = useAtom(pageAtom)
  return (
    <button type="button" onClick={() => void setPage((current) => current + 1)}>
      {`${label}:${page}`}
    </button>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('nuqs-jotai', () => {
  it('reads the URL and commits atom writes to the URL', async () => {
    const user = userEvent.setup()
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <StrictMode>
        <Provider>
          <QueryTestingAdapter searchParams="?page=2" onUrlUpdate={onUrlUpdate}>
            <PageButton label="page" />
          </QueryTestingAdapter>
        </Provider>
      </StrictMode>,
    )

    await user.click(screen.getByRole('button', { name: 'page:2' }))

    expect(screen.getByRole('button').textContent).toBe('page:3')
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce())
    expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get('page')).toBe('3')
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Cannot update a component while rendering a different component',
    )
  })

  it('synchronously follows an authoritative URL navigation', async () => {
    const user = userEvent.setup()

    function NavigationHarness() {
      const [searchParams, setSearchParams] = useState('?page=2')
      return (
        <QueryTestingAdapter searchParams={searchParams}>
          <button type="button" onClick={() => setSearchParams('?page=5')}>
            Navigate
          </button>
          <PageButton label="page" />
        </QueryTestingAdapter>
      )
    }

    render(
      <Provider>
        <NavigationHarness />
      </Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Navigate' }))

    expect(screen.getByRole('button', { name: 'page:5' }).textContent).toBe('page:5')
  })

  it('shares URL state across sibling jotai scopes', async () => {
    const user = userEvent.setup()
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()

    render(
      <Provider>
        <QueryTestingAdapter searchParams="?page=2" onUrlUpdate={onUrlUpdate}>
          <ScopeProvider atoms={[]} name="FirstPagination">
            <PageButton label="first" />
          </ScopeProvider>
          <ScopeProvider atoms={[]} name="SecondPagination">
            <PageButton label="second" />
          </ScopeProvider>
        </QueryTestingAdapter>
      </Provider>,
    )

    expect(screen.getByRole('button', { name: 'first:2' }).textContent).toBe('first:2')
    expect(screen.getByRole('button', { name: 'second:2' }).textContent).toBe('second:2')

    await user.click(screen.getByRole('button', { name: 'first:2' }))

    expect(screen.getByRole('button', { name: 'first:3' }).textContent).toBe('first:3')
    expect(screen.getByRole('button', { name: 'second:3' }).textContent).toBe('second:3')
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce())
  })

  it('rejects writes after its provider unmounts', () => {
    const store = createStore()
    let providerStore: ReturnType<typeof createStore> | undefined

    function StoreCapture() {
      providerStore = useStore()
      return <PageButton label="page" />
    }

    const rendered = render(
      <Provider store={store}>
        <QueryTestingAdapter>
          <StoreCapture />
        </QueryTestingAdapter>
      </Provider>,
    )

    rendered.unmount()

    expect(providerStore).toBeDefined()
    expect(() => providerStore!.set(pageAtom, 2)).toThrow(/outside their mounted provider/)
  })
})

it('supports consecutive functional updates without a value subscriber', async () => {
  let scopedStore: ReturnType<typeof createStore> | undefined
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  function CaptureStore() {
    scopedStore = useStore()
    return null
  }
  render(
    <QueryTestingAdapter searchParams="?page=2" onUrlUpdate={onUrlUpdate}>
      <CaptureStore />
    </QueryTestingAdapter>,
  )
  const first = scopedStore!.set(pageAtom, (page) => page + 1)
  const second = scopedStore!.set(pageAtom, (page) => page + 1)
  expect(scopedStore!.get(pageAtom)).toBe(4)
  await Promise.all([first, second])
  expect(onUrlUpdate).toHaveBeenCalledOnce()
  expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get('page')).toBe('4')
})

it('initializes URL atoms for server rendering', () => {
  const seen: number[] = []
  function InitialRead() {
    const store = useStore()
    const page = store.get(pageAtom)
    seen.push(page)
    return <p>Page {page}</p>
  }
  const html = renderToString(
    <QueryTestingAdapter searchParams="?page=7">
      <InitialRead />
    </QueryTestingAdapter>,
  )
  expect(seen[0]).toBe(7)
  expect(html).toContain('7')
})

it('accepts a descendant layout command during StrictMode mounting', async () => {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  function InitializePage() {
    const setPage = useSetAtom(pageAtom)
    useLayoutEffect(() => {
      void setPage(3)
    }, [setPage])
    return null
  }
  render(
    <StrictMode>
      <QueryTestingAdapter onUrlUpdate={onUrlUpdate}>
        <InitializePage />
      </QueryTestingAdapter>
    </StrictMode>,
  )
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce())
  expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get('page')).toBe('3')
})

it('shares one commit queue across independently declared query atoms', async () => {
  const statusAtom = atomWithSearchParam('status', parseAsInteger.withDefault(0))
  let scopedStore: ReturnType<typeof createStore> | undefined
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  function CaptureStore() {
    scopedStore = useStore()
    return null
  }
  render(
    <QueryTestingAdapter onUrlUpdate={onUrlUpdate}>
      <CaptureStore />
    </QueryTestingAdapter>,
  )
  const first = scopedStore!.set(pageAtom, 2)
  const second = scopedStore!.set(statusAtom, 1, { history: 'push' })
  expect(scopedStore!.get(pageAtom)).toBe(2)
  await Promise.all([first, second])
  expect(onUrlUpdate).toHaveBeenCalledOnce()
  expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.toString()).toBe('page=2&status=1')
})

it('isolates two URL providers using the same atom definitions', async () => {
  const user = userEvent.setup()
  render(
    <>
      <QueryTestingAdapter searchParams="?page=2">
        <PageButton label="first" />
      </QueryTestingAdapter>
      <QueryTestingAdapter searchParams="?page=7">
        <PageButton label="second" />
      </QueryTestingAdapter>
    </>,
  )
  await user.click(screen.getByRole('button', { name: 'first:2' }))
  expect(screen.getByRole('button', { name: 'first:3' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'second:7' })).toBeDefined()
})

it('evaluates functional writes against history before its deferred notification', async () => {
  window.history.replaceState(null, '', '/documents?page=2')
  const adapter = createBrowserQueryAdapter({
    initialUrl: new URL(window.location.href),
    refresh: () => {},
  })
  let scopedStore: ReturnType<typeof createStore> | undefined
  function CaptureStore() {
    scopedStore = useStore()
    return null
  }
  render(
    <QueryStateProvider adapter={adapter}>
      <CaptureStore />
    </QueryStateProvider>,
  )
  window.history.replaceState(null, '', '/documents?page=5')
  const result = scopedStore!.set(pageAtom, (page) => page + 1)
  expect(scopedStore!.get(pageAtom)).toBe(6)
  expect((await result).get('page')).toBe('6')
})

it('supports typed composite patches, URL aliases, option overrides and reset', async () => {
  const selectionAtom = atomWithSearchParams(
    {
      page: parseAsInteger.withDefault(1),
      selected: parseAsInteger,
    },
    { urlKeys: { selected: 'id' }, history: 'push' },
  )
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  let store!: ReturnType<typeof createStore>
  function Capture() {
    store = useStore()
    return null
  }
  render(
    <QueryTestingAdapter searchParams="?page=2&id=5&other=keep" onUrlUpdate={onUrlUpdate}>
      <Capture />
    </QueryTestingAdapter>,
  )
  expectTypeOf(store.get(pageAtom)).toEqualTypeOf<number>()
  expectTypeOf(store.get(selectionAtom)).toEqualTypeOf<{ page: number; selected: number | null }>()
  await store.set(selectionAtom, (previous) => ({ page: previous.page + 1, selected: null }))
  expect(store.get(selectionAtom)).toEqual({ page: 3, selected: null })
  expect(onUrlUpdate).toHaveBeenCalledOnce()
  expect(Object.fromEntries(onUrlUpdate.mock.calls[0]![0].searchParams)).toEqual({
    page: '3',
    other: 'keep',
  })
  expect(onUrlUpdate.mock.calls[0]?.[0].options.history).toBe('push')
  await store.set(selectionAtom, null, { history: 'replace' })
  expect(store.get(selectionAtom)).toEqual({ page: 1, selected: null })
  expect(onUrlUpdate.mock.calls[1]?.[0].queryString).toBe('?other=keep')
  expect(onUrlUpdate.mock.calls[1]?.[0].options.history).toBe('replace')
})

it('exposes write failures through the provider-scoped error atom', async () => {
  const failure = new Error('history failed')
  const adapter = createMemoryQueryAdapter('http://localhost/?page=2')
  adapter.write = () => {
    throw failure
  }
  let store!: ReturnType<typeof createStore>
  function Capture() {
    store = useStore()
    return null
  }
  render(
    <QueryStateProvider adapter={adapter}>
      <Capture />
    </QueryStateProvider>,
  )
  expect(store.get(queryStateErrorAtom)).toBe(null)
  await expect(store.set(pageAtom, 3)).rejects.toBe(failure)
  expect(store.get(queryStateErrorAtom)).toBe(failure)
  expect(store.get(pageAtom)).toBe(2)
})

it('batches field atoms with aliases, functional updates, resets and write options', async () => {
  const { page, selected } = atomsWithSearchParams(
    {
      page: parseAsInteger.withDefault(1),
      selected: parseAsInteger,
    },
    { urlKeys: { selected: 'id' }, history: 'push' },
  )
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  let store!: ReturnType<typeof createStore>
  function Capture() {
    store = useStore()
    return null
  }
  render(
    <QueryTestingAdapter searchParams="?page=2&id=5" onUrlUpdate={onUrlUpdate}>
      <Capture />
    </QueryTestingAdapter>,
  )
  expectTypeOf(store.get(page)).toEqualTypeOf<number>()
  expectTypeOf(store.get(selected)).toEqualTypeOf<number | null>()
  await Promise.all([
    store.set(page, (value) => value + 1),
    store.set(page, (value) => value + 1),
    store.set(selected, (value) => (value ?? 0) + 1),
  ])
  expect(store.get(page)).toBe(4)
  expect(store.get(selected)).toBe(6)
  expect(onUrlUpdate).toHaveBeenCalledOnce()
  expect(Object.fromEntries(onUrlUpdate.mock.calls[0]![0].searchParams)).toEqual({
    page: '4',
    id: '6',
  })
  expect(onUrlUpdate.mock.calls[0]![0].options.history).toBe('push')
  await store.set(selected, null, { history: 'replace' })
  expect(store.get(selected)).toBe(null)
  expect(store.get(page)).toBe(4)
  expect(onUrlUpdate.mock.calls[1]![0].options.history).toBe('replace')
  expect(onUrlUpdate.mock.calls[1]![0].searchParams.has('id')).toBe(false)
})

it('cancels a field draft when external history changes another key in its group', async () => {
  vi.useFakeTimers()
  try {
    const { page, selected } = atomsWithSearchParams(
      {
        page: parseAsInteger.withDefault(1),
        selected: parseAsInteger,
      },
      { limitUrlUpdates: debounce(300), urlKeys: { selected: 'id' } },
    )
    const adapter = createMemoryQueryAdapter('http://localhost/?page=2&id=5')
    let store!: ReturnType<typeof createStore>
    function Capture() {
      store = useStore()
      return null
    }
    render(
      <QueryStateProvider adapter={adapter}>
        <Capture />
      </QueryStateProvider>,
    )
    const pending = store.set(page, 9)
    expect(store.get(page)).toBe(9)
    // Ordinary history replacement, not a traversal; the sibling key must cancel the draft.
    adapter.write(new URL('http://localhost/?page=2&id=6'), {
      history: 'replace',
      shallow: true,
      scroll: false,
    })
    await vi.runAllTimersAsync()
    await pending
    expect(store.get(page)).toBe(2)
    expect(store.get(selected)).toBe(6)
    expect(adapter.read().search).toBe('?page=2&id=6')
  } finally {
    vi.useRealTimers()
  }
})

it.each([false, true])(
  'preserves callback drafts after a commit (functional update: %s)',
  async (increment) => {
    vi.useFakeTimers()
    try {
      let store!: ReturnType<typeof createStore>
      let callbackWrite: Promise<URLSearchParams> | undefined
      const adapter = createMemoryQueryAdapter('http://localhost/?page=1', ({ searchParams }) => {
        if (searchParams.get('page') === '2') {
          callbackWrite = store.set(pageAtom, 3, { limitUrlUpdates: debounce(300) })
        }
      })
      function Capture() {
        store = useStore()
        return null
      }
      render(
        <QueryStateProvider adapter={adapter}>
          <Capture />
        </QueryStateProvider>,
      )
      const initial = store.set(pageAtom, 2)
      await vi.advanceTimersByTimeAsync(0)
      expect((await initial).get('page')).toBe('2')
      if (!increment) expect(store.get(pageAtom)).toBe(3)
      const functionalWrite = increment ? store.set(pageAtom, (page) => page + 1) : undefined
      await vi.runAllTimersAsync()
      await Promise.all([callbackWrite, functionalWrite])
      expect(store.get(pageAtom)).toBe(increment ? 4 : 3)
      expect(adapter.read().searchParams.get('page')).toBe(increment ? '4' : '3')
    } finally {
      vi.useRealTimers()
    }
  },
)

it('retains a callback draft when the preceding adapter write throws', async () => {
  vi.useFakeTimers()
  try {
    let store!: ReturnType<typeof createStore>
    let callbackWrite: Promise<URLSearchParams> | undefined
    const failure = new Error('refresh failed')
    const adapter = createMemoryQueryAdapter('http://localhost/?page=1', ({ searchParams }) => {
      if (searchParams.get('page') === '2') {
        callbackWrite = store.set(pageAtom, 3, { limitUrlUpdates: debounce(300) })
        throw failure
      }
    })
    function Capture() {
      store = useStore()
      return null
    }
    render(
      <QueryStateProvider adapter={adapter}>
        <Capture />
      </QueryStateProvider>,
    )
    const initial = store.set(pageAtom, 2)
    await vi.advanceTimersByTimeAsync(0)
    await expect(initial).rejects.toBe(failure)
    expect(store.get(pageAtom)).toBe(3)
    await vi.runAllTimersAsync()
    expect((await callbackWrite)?.get('page')).toBe('3')
    expect(store.get(queryStateErrorAtom)).toBe(null)
  } finally {
    vi.useRealTimers()
  }
})

it.each(['Suspense', 'Activity'] as const)(
  'accepts descendant layout writes when %s reveals its provider',
  async (boundary) => {
    vi.useFakeTimers()
    try {
      const adapter = createMemoryQueryAdapter('http://localhost/?page=1')
      let scopedStore!: ReturnType<typeof createStore>
      const suspended = new Promise<never>(() => {})
      function Page({ hidden }: { hidden: boolean }) {
        scopedStore = useStore()
        const setPage = useSetAtom(pageAtom)
        useLayoutEffect(() => {
          void setPage((page) => page + 1)
        }, [setPage])
        if (boundary === 'Suspense' && hidden) throw suspended
        return <p>Page ready</p>
      }
      function App({ hidden }: { hidden: boolean }) {
        const content = (
          <QueryStateProvider adapter={adapter}>
            <Page hidden={hidden} />
          </QueryStateProvider>
        )
        return boundary === 'Activity' ? (
          <Activity mode={hidden ? 'hidden' : 'visible'}>{content}</Activity>
        ) : (
          <Suspense fallback={<p>Loading</p>}>{content}</Suspense>
        )
      }
      const rendered = render(<App hidden={false} />)
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(adapter.read().searchParams.get('page')).toBe('2')
      rendered.rerender(<App hidden />)
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      adapter.navigate('/?page=7')
      rendered.rerender(<App hidden={false} />)
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(screen.getByText('Page ready')).toBeDefined()
      expect(adapter.read().searchParams.get('page')).toBe('8')
      let cancelled!: Promise<URLSearchParams>
      act(() => {
        cancelled = scopedStore.set(pageAtom, 99, { limitUrlUpdates: debounce(300) })
      })
      rendered.rerender(<App hidden />)
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect((await cancelled).get('page')).toBe('8')
      rendered.rerender(<App hidden={false} />)
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(adapter.read().searchParams.get('page')).toBe('9')
    } finally {
      vi.useRealTimers()
    }
  },
)

it.each([
  { destination: '/documents?page=9', expected: '9', fails: false },
  { destination: '/documents?page=9', expected: '9', fails: true },
  { destination: '/documents?page=2&other=keep', expected: '3', fails: false },
])(
  'reconciles deferred browser history after refresh ($destination, fails=$fails)',
  async ({ destination, expected, fails }) => {
    vi.useFakeTimers()
    try {
      window.history.replaceState(null, '', '/documents?page=1')
      await Promise.resolve()
      let store!: ReturnType<typeof createStore>
      let draft: Promise<URLSearchParams> | undefined
      const failure = new Error('refresh failed after navigation')
      const adapter = createBrowserQueryAdapter({
        initialUrl: new URL(window.location.href),
        refresh() {
          draft = store.set(pageAtom, 3, { limitUrlUpdates: debounce(300) })
          window.history.replaceState(null, '', destination)
          if (fails) throw failure
        },
      })
      function Capture() {
        store = useStore()
        return null
      }
      render(
        <QueryStateProvider adapter={adapter}>
          <Capture />
        </QueryStateProvider>,
      )
      const commit = store.set(pageAtom, 2, { shallow: false })
      await vi.advanceTimersByTimeAsync(0)
      if (fails) await expect(commit).rejects.toBe(failure)
      else await commit
      expect(store.get(pageAtom)).toBe(Number(expected))
      await vi.runAllTimersAsync()
      expect((await draft)?.get('page')).toBe(expected)
      expect(window.location.search).toBe(expected === '9' ? '?page=9' : '?other=keep&page=3')
    } finally {
      vi.useRealTimers()
    }
  },
)

it.each(['Activity', 'Suspense'] as const)(
  'refreshes a read-only consumer after %s reveals',
  async (boundary) => {
    const adapter = createMemoryQueryAdapter('http://localhost/?page=1')
    const suspended = new Promise<never>(() => {})
    function ReadPage({ hidden }: { hidden: boolean }) {
      const page = useAtomValue(pageAtom)
      if (boundary === 'Suspense' && hidden) throw suspended
      return <p>Page {page}</p>
    }
    function App({ hidden }: { hidden: boolean }) {
      const children = (
        <QueryStateProvider adapter={adapter}>
          <ReadPage hidden={hidden} />
        </QueryStateProvider>
      )
      return boundary === 'Activity' ? (
        <Activity mode={hidden ? 'hidden' : 'visible'}>{children}</Activity>
      ) : (
        <Suspense fallback={<p>Loading</p>}>{children}</Suspense>
      )
    }
    const rendered = render(<App hidden={false} />)
    expect(screen.getByText('Page 1')).toBeDefined()
    rendered.rerender(<App hidden />)
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      adapter.navigate('/?page=7')
    })
    rendered.rerender(<App hidden={false} />)
    expect(screen.getByText('Page 7')).toBeDefined()
  },
)

it.each([false, true])('keeps throttle(Infinity) local (existing timer: %s)', async (queued) => {
  vi.useFakeTimers()
  try {
    window.history.replaceState(null, '', '/documents?page=1')
    await Promise.resolve()
    const refresh = vi.fn()
    const adapter = createBrowserQueryAdapter({
      initialUrl: new URL(window.location.href),
      refresh,
    })
    let store!: ReturnType<typeof createStore>
    function Capture() {
      store = useStore()
      return null
    }
    render(
      <QueryStateProvider adapter={adapter}>
        <Capture />
      </QueryStateProvider>,
    )
    const previous = queued ? store.set(pageAtom, 5, { limitUrlUpdates: debounce(300) }) : undefined
    const pending = store.set(pageAtom, 2, { limitUrlUpdates: throttle(Infinity), shallow: false })
    expect(store.get(pageAtom)).toBe(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(window.location.search).toBe('?page=1')
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect((await pending).get('page')).toBe('1')
    await previous
    const resumed = store.set(pageAtom, (page) => page + 1, { limitUrlUpdates: throttle(100) })
    await vi.advanceTimersByTimeAsync(100)
    expect((await resumed).get('page')).toBe('3')
    expect(refresh).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
