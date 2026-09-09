import type { createStore } from 'jotai'
import { act, render, screen } from '@testing-library/react'
import { useAtomValue, useStore } from 'jotai'
import { debounce, parseAsString } from 'nuqs'
import { atomWithSearchParam } from 'nuqs-jotai'
import { AppRouterContext } from 'vinext/shims/internal/app-router-context'
import { appRouterInstance, navigateClientSide, usePathname } from 'vinext/shims/navigation'
import { QueryStateProvider } from '../query-state-provider'

// Exercise Vinext's real hooks and navigation commit, including its saved history methods.
vi.mock('@/next/navigation', async () => import('vinext/shims/navigation'))

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

function RoutedSearch() {
  const pathname = usePathname()
  return <Search key={pathname} />
}

function TestApp() {
  // Vinext also exports this module in server contexts where it can be null.
  if (!AppRouterContext) throw new Error('Vinext AppRouterContext is unavailable')
  return (
    <AppRouterContext value={appRouterInstance}>
      <QueryStateProvider>
        <RoutedSearch />
      </QueryStateProvider>
    </AppRouterContext>
  )
}

beforeEach(async () => {
  vi.useFakeTimers()
  await navigateClientSide('/first?search=first', 'replace', false)
})
afterEach(() => vi.useRealTimers())

it.each(['push', 'replace'] as const)(
  'syncs same-path Vinext %s navigation and cancels the old draft',
  async (mode) => {
    render(<TestApp />)
    expect(screen.getByText('Search: first')).toBeInTheDocument()
    act(() => {
      void scopedStore.set(searchAtom, 'draft')
    })
    expect(screen.getByText('Search: draft')).toBeInTheDocument()
    await act(async () => {
      await navigateClientSide('/first?search=second', mode, false)
    })
    expect(screen.getByText('Search: second')).toBeInTheDocument()
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(window.location.search).toBe('?search=second')
  },
)

it('syncs same-path navigation without a pending write', async () => {
  render(<TestApp />)
  await act(async () => {
    await navigateClientSide('/first?search=second', 'push', false)
  })
  expect(screen.getByText('Search: second')).toBeInTheDocument()
})

it('retains a new draft when router hooks catch up with an atom URL commit', async () => {
  render(<TestApp />)
  await act(async () => {
    void scopedStore.set(searchAtom, 'committed', { limitUrlUpdates: debounce(0) })
    await vi.runAllTimersAsync()
    void scopedStore.set(searchAtom, 'next draft')
  })
  expect(screen.getByText('Search: next draft')).toBeInTheDocument()
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  expect(window.location.search).toBe('?search=next+draft')
})

it.each([
  { mode: 'push', draft: false },
  { mode: 'replace', draft: false },
  { mode: 'push', draft: true },
  { mode: 'replace', draft: true },
] as const)(
  'reads the destination URL after a page remount ($mode, draft=$draft)',
  async ({ mode, draft }) => {
    render(<TestApp />)
    expect(screen.getByText('Search: first')).toBeInTheDocument()
    if (draft) {
      act(() => {
        void scopedStore.set(searchAtom, 'old draft')
      })
      expect(screen.getByText('Search: old draft')).toBeInTheDocument()
    }
    await act(async () => {
      await navigateClientSide('/second?search=second', mode, false)
    })
    expect(screen.getByText('Search: second')).toBeInTheDocument()
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(window.location.search).toBe('?search=second')
  },
)
