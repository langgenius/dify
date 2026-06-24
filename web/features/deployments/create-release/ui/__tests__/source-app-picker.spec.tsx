import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceAppPicker } from '../source-app-picker'

const mocks = vi.hoisted(() => {
  const sourceAppsQuery = {
    data: {
      pages: [{
        data: [{
          id: 'app-1',
          name: 'Workflow App',
        }],
      }],
    },
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: true,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
  }

  return {
    sourceAppsQuery,
    useInfiniteScroll: vi.fn(() => ({
      rootEl: null,
      rootRef: vi.fn(),
      sentinelEl: null,
      sentinelRef: vi.fn(),
    })),
  }
})

vi.mock('@/features/deployments/create-release/state', async () => {
  const { atom } = await import('jotai')

  return {
    createReleaseSourceAppSearchTextAtom: atom(''),
    createReleaseSourceAppsQueryAtom: atom(mocks.sourceAppsQuery),
  }
})

vi.mock('@/features/deployments/shared/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: mocks.useInfiniteScroll,
}))

function renderSourceAppPicker(disabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SourceAppPicker
        value={{ id: 'app-1', name: 'Workflow 1' }}
        onChange={() => undefined}
        disabled={disabled}
      />
    </QueryClientProvider>,
  )
}

describe('SourceAppPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.sourceAppsQuery, {
      data: {
        pages: [{
          data: [{
            id: 'app-1',
            name: 'Workflow App',
          }],
        }],
      },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: true,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  it('should disable the switch control when disabled', () => {
    renderSourceAppPicker(true)

    expect(screen.getByText('Workflow 1')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'deployments.versions.sourceAppOption' })).toBeDisabled()
  })

  it('should use infinite scroll to load more apps when the picker is open', async () => {
    const user = userEvent.setup()

    renderSourceAppPicker(false)

    expect(mocks.useInfiniteScroll).toHaveBeenCalledWith(
      mocks.sourceAppsQuery,
      expect.objectContaining({
        enabled: false,
        rootMargin: '0px 0px 160px 0px',
        threshold: 0.1,
      }),
    )

    await user.click(screen.getByRole('combobox', { name: 'deployments.versions.sourceAppOption' }))

    await waitFor(() => {
      expect(mocks.useInfiniteScroll).toHaveBeenLastCalledWith(
        mocks.sourceAppsQuery,
        expect.objectContaining({
          enabled: true,
          rootMargin: '0px 0px 160px 0px',
          threshold: 0.1,
        }),
      )
    })
    expect(screen.queryByRole('button', { name: /createModal\.loadMoreApps/ })).not.toBeInTheDocument()
  })
})
