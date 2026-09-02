import type { OnUrlUpdateFunction } from 'nuqs/adapters/testing'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider, useAtom, useStore } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { parseAsInteger } from 'nuqs'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createQueryAtoms, NuqsJotaiBridge } from './index'

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
  it('reads the URL and delegates atom writes to nuqs', async () => {
    const user = userEvent.setup()
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <StrictMode>
        <Provider>
          <NuqsTestingAdapter searchParams="?page=2" onUrlUpdate={onUrlUpdate}>
            <NuqsJotaiBridge config={paginationQuery}>
              <PageButton label="page" />
            </NuqsJotaiBridge>
          </NuqsTestingAdapter>
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
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <button type="button" onClick={() => setSearchParams('?page=5')}>
            Navigate
          </button>
          <NuqsJotaiBridge config={paginationQuery}>
            <PageButton label="page" />
          </NuqsJotaiBridge>
        </NuqsTestingAdapter>
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
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>()

    render(
      <Provider>
        <NuqsTestingAdapter searchParams="?page=2" onUrlUpdate={onUrlUpdate}>
          <NuqsJotaiBridge config={paginationQuery}>
            <ScopeProvider atoms={[]} name="FirstPagination">
              <PageButton label="first" />
            </ScopeProvider>
            <ScopeProvider atoms={[]} name="SecondPagination">
              <PageButton label="second" />
            </ScopeProvider>
          </NuqsJotaiBridge>
        </NuqsTestingAdapter>
      </Provider>,
    )

    expect(screen.getByRole('button', { name: 'first:2' }).textContent).toBe('first:2')
    expect(screen.getByRole('button', { name: 'second:2' }).textContent).toBe('second:2')

    await user.click(screen.getByRole('button', { name: 'first:2' }))

    expect(screen.getByRole('button', { name: 'first:3' }).textContent).toBe('first:3')
    expect(screen.getByRole('button', { name: 'second:3' }).textContent).toBe('second:3')
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce())
  })

  it('rejects writes after its bridge unmounts', () => {
    const store = createStore()
    let bridgeStore: ReturnType<typeof createStore> | undefined

    function StoreCapture() {
      bridgeStore = useStore()
      return <PageButton label="page" />
    }

    const rendered = render(
      <Provider store={store}>
        <NuqsTestingAdapter>
          <NuqsJotaiBridge config={paginationQuery}>
            <StoreCapture />
          </NuqsJotaiBridge>
        </NuqsTestingAdapter>
      </Provider>,
    )

    rendered.unmount()

    expect(bridgeStore).toBeDefined()
    expect(() => bridgeStore!.set(paginationQuery.atoms.page, 2)).toThrow(
      /before mounting their NuqsJotaiBridge/,
    )
  })
})
