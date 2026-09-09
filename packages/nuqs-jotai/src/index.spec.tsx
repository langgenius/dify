import type { UrlUpdateEvent } from './testing'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useAtom, useSetAtom, useStore } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { parseAsInteger } from 'nuqs'
import { StrictMode, useLayoutEffect, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createBrowserQueryAdapter } from './browser'
import { createQueryAtoms, QueryStateProvider } from './index'
import { QueryTestingAdapter } from './testing'

const paginationQuery = createQueryAtoms(
  {
    page: parseAsInteger.withDefault(1),
  },
  { debugLabel: 'pagination' },
)

function PageButton({ label }: { label: string }) {
  const [page, setPage] = useAtom(paginationQuery.atoms.page)
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
    expect(() => providerStore!.set(paginationQuery.atoms.page, 2)).toThrow(
      /outside their mounted provider/,
    )
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
  const first = scopedStore!.set(paginationQuery.atoms.page, (page) => page + 1)
  const second = scopedStore!.set(paginationQuery.atoms.page, (page) => page + 1)
  expect(scopedStore!.get(paginationQuery.atoms.page)).toBe(4)
  await Promise.all([first, second])
  expect(onUrlUpdate).toHaveBeenCalledOnce()
  expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get('page')).toBe('4')
})

it('initializes URL atoms for server rendering', () => {
  const seen: number[] = []
  function InitialRead() {
    const store = useStore()
    const page = store.get(paginationQuery.atoms.page)
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
    const setPage = useSetAtom(paginationQuery.atoms.page)
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
  const filterQuery = createQueryAtoms({ status: parseAsInteger.withDefault(0) })
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
  const first = scopedStore!.set(paginationQuery.atoms.page, 2)
  const second = scopedStore!.set(filterQuery.atoms.status, 1, { history: 'push' })
  expect(scopedStore!.get(paginationQuery.atoms.page)).toBe(2)
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
  const result = scopedStore!.set(paginationQuery.atoms.page, (page) => page + 1)
  expect(scopedStore!.get(paginationQuery.atoms.page)).toBe(6)
  expect((await result).get('page')).toBe('6')
})
