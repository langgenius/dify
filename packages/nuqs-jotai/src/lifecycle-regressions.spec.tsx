import { act, cleanup, render, screen } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import { debounce, parseAsInteger, parseAsString, throttle, useQueryState } from 'nuqs'
import { enableHistorySync, NuqsAdapter } from 'nuqs/adapters/react'
import { Activity, StrictMode, useLayoutEffect } from 'react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { atomWithSearchParam, QueryStateProvider, useQueryAtomValue } from './index'

afterEach(() => {
  act(() => window.dispatchEvent(new PopStateEvent('popstate')))
  cleanup()
  vi.useRealTimers()
})

it.each([0, Infinity])(
  'observes a descendant layout write on mount (throttle %s)',
  async (delay) => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/?page=1')
    const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
    function Reader() {
      return <p>Page {useQueryAtomValue(page)}</p>
    }
    function Writer() {
      const set = useSetAtom(page)
      useLayoutEffect(() => {
        void set(2, { limitUrlUpdates: throttle(delay) })
      }, [set])
      return null
    }
    render(
      <StrictMode>
        <NuqsAdapter>
          <QueryStateProvider atoms={[page]}>
            <Reader />
            <Writer />
          </QueryStateProvider>
        </NuqsAdapter>
      </StrictMode>,
    )
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(screen.getByText('Page 2')).toBeDefined()
  },
)

it('reads the current URL in the first layout effect after Activity reveal', async () => {
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  window.history.replaceState(null, '', '/?page=1')
  const seen: number[] = []
  function Reader() {
    const value = useQueryAtomValue(page)
    useLayoutEffect(() => {
      seen.push(value)
    }, [])
    return <p>Page {value}</p>
  }
  function App({ hidden }: { hidden: boolean }) {
    return (
      <Activity mode={hidden ? 'hidden' : 'visible'}>
        <NuqsAdapter>
          <QueryStateProvider atoms={[page]}>
            <Reader />
          </QueryStateProvider>
        </NuqsAdapter>
      </Activity>
    )
  }
  const view = render(<App hidden={false} />)
  view.rerender(<App hidden />)
  await act(async () => {
    window.history.replaceState(null, '', '/?page=7')
  })
  seen.length = 0
  view.rerender(<App hidden={false} />)
  expect(screen.getByText('Page 7')).toBeDefined()
  expect(seen).toEqual([7])
})

it.each(['nuqs-first', 'atom-first'] as const)(
  'shares one queue with nuqs during debounce and push (%s)',
  async (order) => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/?page=1')
    enableHistorySync()
    const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
    const search = atomWithSearchParam('q', parseAsString)
    let setSearch!: (value: string) => Promise<URLSearchParams>
    let setPage!: (value: number) => Promise<URLSearchParams>
    function Capture() {
      const atomPage = useSetAtom(page)
      const atomSearch = useSetAtom(search)
      const [, nuqsPage] = useQueryState('page', parseAsInteger)
      const [, nuqsSearch] = useQueryState('q', parseAsString)
      setSearch = (value) =>
        order === 'nuqs-first'
          ? nuqsSearch(value, { limitUrlUpdates: debounce(500) })
          : atomSearch(value, { limitUrlUpdates: debounce(500) })
      setPage = (value) =>
        order === 'nuqs-first'
          ? atomPage(value, { history: 'push' })
          : nuqsPage(value, { history: 'push' })
      return <p>{useQueryAtomValue(search)}</p>
    }
    render(
      <NuqsAdapter>
        <QueryStateProvider atoms={[page, search]}>
          <Capture />
        </QueryStateProvider>
      </NuqsAdapter>,
    )
    let pending!: Promise<URLSearchParams>
    act(() => {
      pending = setSearch('draft')
      void setPage(2)
    })
    expect(screen.getByText('draft')).toBeDefined()
    await act(async () => {
      await vi.runAllTimersAsync()
      await pending
    })
    expect(new URLSearchParams(window.location.search).get('page')).toBe('2')
    expect(new URLSearchParams(window.location.search).get('q')).toBe('draft')
  },
)

it('forwards reveal layout commands after nuqs reattaches its subscriptions', async () => {
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/?page=1')
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  function Consumer() {
    const value = useQueryAtomValue(page)
    const write = useSetAtom(page)
    useLayoutEffect(() => {
      void write((current) => current + 1)
    }, [write])
    return <p>{value}</p>
  }
  function App({ hidden }: { hidden: boolean }) {
    return (
      <Activity mode={hidden ? 'hidden' : 'visible'}>
        <NuqsAdapter>
          <QueryStateProvider atoms={[page]}>
            <Consumer />
          </QueryStateProvider>
        </NuqsAdapter>
      </Activity>
    )
  }
  const view = render(<App hidden={false} />)
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  expect(screen.getByText('2')).toBeDefined()
  view.rerender(<App hidden />)
  window.history.replaceState(null, '', '/?page=7')
  view.rerender(<App hidden={false} />)
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  expect(screen.getByText('8')).toBeDefined()
  expect(window.location.search).toBe('?page=8')
})

it('refreshes a hidden reader while its URL bridge remains mounted', async () => {
  window.history.replaceState(null, '', '/?page=1')
  const page = atomWithSearchParam('page', parseAsInteger.withDefault(1))
  const seen: number[] = []
  function Consumer() {
    const value = useQueryAtomValue(page)
    useLayoutEffect(() => {
      seen.push(value)
    }, [])
    return <p>{value}</p>
  }
  function App({ hidden }: { hidden: boolean }) {
    return (
      <NuqsAdapter>
        <QueryStateProvider atoms={[page]}>
          <Activity mode={hidden ? 'hidden' : 'visible'}>
            <Consumer />
          </Activity>
        </QueryStateProvider>
      </NuqsAdapter>
    )
  }
  const view = render(<App hidden={false} />)
  view.rerender(<App hidden />)
  await act(async () => {
    window.history.replaceState(null, '', '/?page=7')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  seen.length = 0
  view.rerender(<App hidden={false} />)
  expect(seen).toEqual([7])
})
