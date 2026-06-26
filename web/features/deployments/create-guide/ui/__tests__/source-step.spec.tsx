import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceStepContent } from '../source-step'

const mocks = vi.hoisted(() => {
  const sourceAppsQuery = {
    data: { pages: [{ data: [] }] },
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    isPlaceholderData: false,
    fetchNextPage: vi.fn(),
  }

  return {
    sourceAppsQuery,
    useInfiniteScroll: vi.fn(() => ({
      rootRef: vi.fn(),
      sentinelRef: vi.fn(),
    })),
  }
})

vi.mock('@/features/deployments/shared/hooks/use-infinite-scroll', () => ({
  useInfiniteScroll: mocks.useInfiniteScroll,
}))

vi.mock('@/features/deployments/create-guide/state', async () => {
  const { atom } = await import('jotai')
  const methodAtom = atom<'bindApp' | 'importDsl'>('bindApp')
  const emptyActionAtom = atom(null, () => undefined)

  return {
    continueFromSourceAtom: emptyActionAtom,
    dslFileAtom: atom<File | undefined>(undefined),
    dslReadErrorAtom: atom(false),
    dslUnsupportedModeAtom: atom(false),
    effectiveMethodAtom: atom(get => get(methodAtom)),
    effectiveSelectedAppAtom: atom(undefined),
    isReadingDslAtom: atom(false),
    methodAtom,
    selectDslFileAtom: emptyActionAtom,
    selectMethodAtom: atom(null, (_get, set, value: 'bindApp' | 'importDsl') => {
      set(methodAtom, value)
    }),
    selectSourceAppAtom: emptyActionAtom,
    setSourceSearchTextAtom: emptyActionAtom,
    sourceAppsQueryAtom: atom(mocks.sourceAppsQuery),
    sourceCanGoNextAtom: atom(false),
    sourceSearchTextAtom: atom(''),
    unsupportedDslNodesAtom: atom([]),
  }
})

describe('SourceStepContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.sourceAppsQuery, {
      data: { pages: [{ data: [] }] },
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
      isPlaceholderData: false,
      fetchNextPage: vi.fn(),
    })
  })

  it('should hide the import DSL option when deployment DSL import is disabled', () => {
    render(<SourceStepContent />)

    expect(screen.getByText(/createGuide\.methods\.bindApp\.title/)).toBeInTheDocument()
    expect(screen.queryByText(/createGuide\.methods\.importDsl\.title/)).not.toBeInTheDocument()
    expect(screen.queryByText(/createGuide\.methods\.importDsl\.description/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /createGuide\.source\.sourceApp/ })).toBeInTheDocument()
  })

  it('should use infinite scroll to load more source apps', () => {
    Object.assign(mocks.sourceAppsQuery, {
      data: {
        pages: [{
          data: [{
            id: 'app-1',
            name: 'Workflow App',
          }],
        }],
      },
      hasNextPage: true,
    })

    render(<SourceStepContent />)

    expect(mocks.useInfiniteScroll).toHaveBeenCalledWith(
      mocks.sourceAppsQuery,
      expect.objectContaining({
        rootMargin: '0px 0px 160px 0px',
        threshold: 0.1,
      }),
    )
    expect(screen.queryByRole('button', { name: /createModal\.loadMoreApps/ })).not.toBeInTheDocument()
  })
})
