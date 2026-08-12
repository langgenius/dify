import { act, render, screen } from '@testing-library/react'
import { Provider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceStepContent } from '../source-step'

const mocks = vi.hoisted(() => {
  const sourceAppsQuery = {
    data: { pages: [{ data: [] }] },
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    isPlaceholderData: false,
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

vi.mock('@/features/deployments/create-guide/state/primitives', async () => {
  const { atom } = await import('jotai')
  const methodAtom = atom<'bindApp' | 'importDsl'>('bindApp')

  return {
    dslFileAtom: atom<File | undefined>(undefined),
    effectiveMethodAtom: atom((get) => get(methodAtom)),
    methodAtom,
    sourceSearchTextAtom: atom(''),
  }
})

vi.mock('@/features/deployments/create-guide/state/source', async () => {
  const { atom } = await import('jotai')

  return {
    dslReadErrorAtom: atom(false),
    dslUnsupportedModeAtom: atom(false),
    effectiveSelectedAppAtom: atom(undefined),
    isReadingDslAtom: atom(false),
    sourceAppsAtom: atom(() => mocks.sourceAppsQuery.data.pages.flatMap((page) => page.data)),
    sourceAppsErrorAtom: atom(() => mocks.sourceAppsQuery.error),
    sourceAppsFetchNextPageAtom: atom(() => mocks.sourceAppsQuery.fetchNextPage),
    sourceAppsHasNextPageAtom: atom(() => mocks.sourceAppsQuery.hasNextPage),
    sourceAppsIsFetchingAtom: atom(() => mocks.sourceAppsQuery.isFetching),
    sourceAppsIsFetchingNextPageAtom: atom(() => mocks.sourceAppsQuery.isFetchingNextPage),
    sourceAppsIsLoadingAtom: atom(() => mocks.sourceAppsQuery.isLoading),
    sourceAppsIsPlaceholderDataAtom: atom(() => mocks.sourceAppsQuery.isPlaceholderData),
    sourceAppsQueryAtom: atom(mocks.sourceAppsQuery),
  }
})

vi.mock('@/features/deployments/create-guide/state/workflow', async () => {
  const { atom } = await import('jotai')
  const { methodAtom } = await import('@/features/deployments/create-guide/state/primitives')
  const emptyActionAtom = atom(null, () => undefined)

  return {
    continueFromSourceAtom: emptyActionAtom,
    selectDslFileAtom: emptyActionAtom,
    selectMethodAtom: atom(null, (_get, set, value: 'bindApp' | 'importDsl') => {
      set(methodAtom, value)
    }),
    selectSourceAppAtom: emptyActionAtom,
    setSourceSearchTextAtom: emptyActionAtom,
    sourceCanGoNextAtom: atom(false),
  }
})

vi.mock('@/features/deployments/create-guide/state/queries', async () => {
  const { atom } = await import('jotai')

  return {
    unsupportedDslNodesAtom: atom([]),
  }
})

describe('SourceStepContent', () => {
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
      data: { pages: [{ data: [] }] },
      error: null,
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should hide the import DSL option when deployment DSL import is disabled', () => {
    render(
      <Provider>
        <SourceStepContent />
      </Provider>,
    )

    expect(screen.getByText(/createGuide\.methods\.bindApp\.title/)).toBeInTheDocument()
    expect(screen.queryByText(/createGuide\.methods\.importDsl\.title/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/createGuide\.methods\.importDsl\.description/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: /createGuide\.source\.sourceApp/ }),
    ).toBeInTheDocument()
  })

  it('should use infinite scroll to load more source apps', () => {
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
      hasNextPage: true,
    })

    render(
      <Provider>
        <SourceStepContent />
      </Provider>,
    )

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
})
