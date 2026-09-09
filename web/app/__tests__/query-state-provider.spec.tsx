import type { createStore } from 'jotai'
import { act, render, screen } from '@testing-library/react'
import { useAtomValue, useStore } from 'jotai'
import { debounce, parseAsString } from 'nuqs'
import { atomWithSearchParam } from 'nuqs-jotai'
import { QueryStateProvider } from '../query-state-provider'

const navigation = vi.hoisted(() => ({ pathname: '/first', replace: vi.fn() }))
vi.mock('@/next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: navigation.replace }),
}))

const searchAtom = atomWithSearchParam(
  'search',
  parseAsString.withDefault('').withOptions({ limitUrlUpdates: debounce(300) }),
)

let scopedStore: ReturnType<typeof createStore>
function Search() {
  scopedStore = useStore()
  const value = useAtomValue(searchAtom)
  return <p>Search: {value || 'empty'}</p>
}

beforeEach(() => {
  vi.useFakeTimers()
  navigation.pathname = '/first'
  navigation.replace.mockClear()
  window.history.replaceState(null, '', '/first?other=keep#anchor')
})
afterEach(() => vi.useRealTimers())

it('cancels a draft when the router changes pathname before browser history commits', async () => {
  const rendered = render(
    <QueryStateProvider>
      <Search />
    </QueryStateProvider>,
  )
  act(() => {
    void scopedStore.set(searchAtom, 'draft')
  })
  expect(screen.getByText('Search: draft')).toBeInTheDocument()
  navigation.pathname = '/second'
  rendered.rerender(
    <QueryStateProvider>
      <Search />
    </QueryStateProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(window.location.search).toBe('?other=keep')
  expect(navigation.replace).not.toHaveBeenCalled()
  await act(async () => {
    window.history.pushState(null, '', '/second?search=next')
  })
  expect(screen.getByText('Search: next')).toBeInTheDocument()
})

it('pushes the address once and requests a non-shallow route refresh', async () => {
  const initialHistoryLength = window.history.length
  render(
    <QueryStateProvider>
      <Search />
    </QueryStateProvider>,
  )
  act(() => {
    void scopedStore.set(searchAtom, 'draft', { history: 'push', shallow: false })
  })
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  expect(window.history.length).toBe(initialHistoryLength + 1)
  expect(window.location.search).toBe('?other=keep&search=draft')
  expect(window.location.hash).toBe('#anchor')
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
    '/first?other=keep&search=draft#anchor',
    { scroll: false },
  )
})
