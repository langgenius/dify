import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceAppPicker } from '../source-app-picker'

const mocks = vi.hoisted(() => {
  const sourceAppsQuery = {
    data: {
      pages: [
        {
          data: [
            {
              id: 'app-1',
              name: 'Workflow App',
            },
          ],
        },
      ],
    },
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: true,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
  }

  return { sourceAppsQuery }
})

type ObserverRecord = {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
}

const observers: ObserverRecord[] = []

function getInfiniteScrollObserver() {
  return observers.find(({ options }) => options?.rootMargin === '0px 0px 160px 0px')
}

vi.mock('@/features/deployments/create-release/state', async () => {
  const { atom } = await import('jotai')

  return {
    createReleaseSourceAppsAtom: atom(() =>
      mocks.sourceAppsQuery.data.pages.flatMap((page) => page.data),
    ),
    createReleaseSourceAppsErrorAtom: atom(() => mocks.sourceAppsQuery.error),
    createReleaseSourceAppsFetchNextPageAtom: atom(() => mocks.sourceAppsQuery.fetchNextPage),
    createReleaseSourceAppsHasNextPageAtom: atom(() => mocks.sourceAppsQuery.hasNextPage),
    createReleaseSourceAppsIsFetchingAtom: atom(() => mocks.sourceAppsQuery.isFetching),
    createReleaseSourceAppsIsFetchingNextPageAtom: atom(
      () => mocks.sourceAppsQuery.isFetchingNextPage,
    ),
    createReleaseSourceAppsIsLoadingAtom: atom(() => mocks.sourceAppsQuery.isLoading),
    createReleaseSourceAppSearchTextAtom: atom(''),
    createReleaseSourceAppsQueryAtom: atom(mocks.sourceAppsQuery),
  }
})

function renderSourceAppPicker(disabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <Provider>
      <QueryClientProvider client={queryClient}>
        <SourceAppPicker
          value={{ id: 'app-1', name: 'Workflow 1', mode: 'workflow', icon_url: null }}
          onChange={() => undefined}
          disabled={disabled}
        />
      </QueryClientProvider>
    </Provider>,
  )
}

describe('SourceAppPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sourceAppsQuery.fetchNextPage.mockReset()
    observers.length = 0
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        readonly root = null
        readonly rootMargin = ''
        readonly scrollMargin = ''
        readonly thresholds: ReadonlyArray<number> = []
        readonly disconnect = vi.fn()
        readonly observe = vi.fn()
        readonly takeRecords = () => []
        readonly unobserve = vi.fn()

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observers.push({ callback, options })
        }
      },
    )
    Object.assign(mocks.sourceAppsQuery, {
      data: {
        pages: [
          {
            data: [
              {
                id: 'app-1',
                name: 'Workflow App',
              },
            ],
          },
        ],
      },
      error: null,
      hasNextPage: true,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should disable the switch control when disabled', () => {
    renderSourceAppPicker(true)

    expect(screen.getByText('Workflow 1')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'deployments.versions.sourceAppOption' }),
    ).toBeDisabled()
  })

  it('should use infinite scroll to load more apps when the picker is open', async () => {
    const user = userEvent.setup()

    renderSourceAppPicker(false)
    expect(getInfiniteScrollObserver()).toBeUndefined()

    await user.click(screen.getByRole('combobox', { name: 'deployments.versions.sourceAppOption' }))

    await waitFor(() => {
      expect(getInfiniteScrollObserver()).toBeDefined()
    })
    act(() => {
      getInfiniteScrollObserver()?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    expect(mocks.sourceAppsQuery.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false })
    expect(
      screen.queryByRole('button', { name: /createModal\.loadMoreApps/ }),
    ).not.toBeInTheDocument()
  })

  it('should restore the selected app by business identity', async () => {
    const user = userEvent.setup()

    renderSourceAppPicker(false)

    await user.click(screen.getByRole('combobox', { name: 'deployments.versions.sourceAppOption' }))

    expect(screen.getByRole('option', { name: /Workflow App/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})
