import type { ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import {
  debounce,
  parseAsInteger,
  parseAsIsoDate,
  parseAsString,
  throttle,
  useQueryState,
} from 'nuqs'
import { enableHistorySync, NuqsAdapter } from 'nuqs/adapters/react'
import { Activity, StrictMode, useLayoutEffect } from 'react'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  atomWithSearchParam,
  atomWithSearchParams,
  QueryStateProvider,
  useQueryAtomValue,
} from './index'
import { QueryTestingAdapter } from './testing'

afterEach(() => {
  act(() => window.dispatchEvent(new PopStateEvent('popstate')))
  cleanup()
  vi.useRealTimers()
})

it.each([
  { reverse: false, delay: 0 },
  { reverse: true, delay: 0 },
  { reverse: false, delay: Infinity },
  { reverse: true, delay: Infinity },
])(
  'shares typed mount and reveal writes across groups ($reverse, $delay)',
  async ({ reverse, delay }) => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/?day=2026-09-09')
    const first = atomWithSearchParams({ date: parseAsIsoDate }, { urlKeys: { date: 'day' } })
    const second = atomWithSearchParam('day', parseAsIsoDate)
    let date = new Date('2026-09-09T12:34:56.000Z')
    function NativeReader({ children }: { children?: ReactNode }) {
      const [value] = useQueryState('day', parseAsIsoDate)
      return (
        <>
          <p data-testid="native">{value?.toISOString()}</p>
          {children}
        </>
      )
    }
    function Consumer() {
      const write = useSetAtom(second)
      const a = useQueryAtomValue(first).date
      const b = useQueryAtomValue(second)
      useLayoutEffect(() => {
        void write(date, { limitUrlUpdates: throttle(delay) })
      }, [write])
      return (
        <>
          <p data-testid="first">{a?.toISOString()}</p>
          <p data-testid="second">{b?.toISOString()}</p>
          <NativeReader />
        </>
      )
    }
    function App({ hidden }: { hidden: boolean }) {
      return (
        <StrictMode>
          <Activity mode={hidden ? 'hidden' : 'visible'}>
            <NuqsAdapter>
              <NativeReader>
                <QueryStateProvider atoms={reverse ? [second, first] : [first, second]}>
                  <Consumer />
                </QueryStateProvider>
              </NativeReader>
            </NuqsAdapter>
          </Activity>
        </StrictMode>
      )
    }
    const view = render(<App hidden={false} />)
    async function expectSharedDate() {
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(screen.getByTestId('first').textContent).toBe(date.toISOString())
      expect(screen.getByTestId('second').textContent).toBe(date.toISOString())
      for (const reader of screen.getAllByTestId('native'))
        expect(reader.textContent).toBe(date.toISOString())
    }
    await expectSharedDate()
    view.rerender(<App hidden />)
    date = new Date('2026-09-10T15:00:00.000Z')
    window.history.replaceState(null, '', '/?day=2026-09-10')
    view.rerender(<App hidden={false} />)
    await expectSharedDate()
  },
)

it('rejects buffered mount commands when unmounted before the effect-pass drain', async () => {
  const page = atomWithSearchParam('page', parseAsInteger)
  const onUrlUpdate = vi.fn()
  let command!: Promise<URLSearchParams>
  function Writer() {
    const write = useSetAtom(page)
    useLayoutEffect(() => {
      command = write(2)
    }, [write])
    return null
  }
  const view = render(
    <QueryTestingAdapter atoms={[page]} onUrlUpdate={onUrlUpdate}>
      <Writer />
    </QueryTestingAdapter>,
  )
  const rejected = expect(command).rejects.toThrow('unmounts')
  view.unmount()
  await rejected
  expect(onUrlUpdate).not.toHaveBeenCalled()
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
