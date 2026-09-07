import type { MarketplaceCollection } from '@dify/contracts/marketplace'
import type { ReactNode } from 'react'
import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import ListWrapper from '../list-wrapper'

const mockMarketplaceData = vi.hoisted(() => ({
  plugins: undefined as Plugin[] | undefined,
  pluginsTotal: 0,
  marketplaceCollections: [] as MarketplaceCollection[],
  marketplaceCollectionPluginsMap: {} as Record<string, Plugin[]>,
  isLoading: false,
  isRefreshing: false,
  isError: false,
  refetch: vi.fn(),
  isFetchingNextPage: false,
  page: 1,
}))

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        if (key === 'marketplace.pluginsResult') return `${options?.num} plugins found`
        return key
      }),
    }),
  }
})

vi.mock('@/app/components/base/loading', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="loading" className={className}>
      loading
    </div>
  ),
}))

vi.mock('../../sort-dropdown', () => ({
  default: () => <div data-testid="sort-dropdown">sort</div>,
}))

vi.mock('../index', () => ({
  default: ({ plugins }: { plugins?: Plugin[] }) => (
    <div data-testid="list">{plugins?.length ?? 'collections'}</div>
  ),
}))

vi.mock('../../state', () => ({
  useMarketplaceData: () => mockMarketplaceData,
}))

// ListWrapper reads the raw `q` through nuqs for its analytics flush, so the
// tree needs an adapter even though the data hook itself is mocked.
const renderListWrapper = (ui: ReactNode) => {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ searchParams: '' })
  return render(<NuqsWrapper>{ui}</NuqsWrapper>)
}

describe('ListWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.pluginsTotal = 0
    mockMarketplaceData.marketplaceCollections = []
    mockMarketplaceData.marketplaceCollectionPluginsMap = {}
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.isRefreshing = false
    mockMarketplaceData.isError = false
    mockMarketplaceData.isFetchingNextPage = false
    mockMarketplaceData.page = 1
  })

  it('shows result header and sort dropdown when plugins are loaded', () => {
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]
    mockMarketplaceData.pluginsTotal = 1

    renderListWrapper(<ListWrapper />)

    expect(screen.getByText('1 plugins found')).toBeInTheDocument()
    expect(screen.getByTestId('sort-dropdown')).toBeInTheDocument()
  })

  it('shows centered loading on a cold start', () => {
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 1

    renderListWrapper(<ListWrapper />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  // The reported "jitter": every debounced keystroke used to unmount the grid
  // behind a centre-absolute spinner, collapsing the container height and
  // jumping the scroll position.
  it('keeps the result grid mounted while a superseded query is in flight', () => {
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]
    mockMarketplaceData.pluginsTotal = 1
    mockMarketplaceData.isRefreshing = true

    renderListWrapper(<ListWrapper />)

    const list = screen.getByTestId('list')
    expect(list).toBeInTheDocument()
    expect(list.parentElement).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
  })

  it('renders list when loading additional pages', () => {
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 2
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]

    renderListWrapper(<ListWrapper showInstallButton />)

    expect(screen.getByTestId('list')).toBeInTheDocument()
  })

  it('shows bottom loading indicator while fetching next page', () => {
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]
    mockMarketplaceData.isFetchingNextPage = true

    renderListWrapper(<ListWrapper />)

    expect(screen.getAllByTestId('loading')).toHaveLength(1)
  })

  it('keeps the supplied layout constraint while category results are loading', () => {
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 1

    const { container } = renderListWrapper(<ListWrapper className="catalog-content-min-height" />)

    expect(container.firstElementChild).toHaveClass('catalog-content-min-height')
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  // A failed search used to arrive as a successful empty page and render as
  // "no plugins found", with nothing to retry.
  it('offers a retry when the search failed with nothing to show', async () => {
    const user = userEvent.setup()
    mockMarketplaceData.isError = true
    mockMarketplaceData.plugins = []

    renderListWrapper(<ListWrapper />)

    expect(screen.queryByTestId('list')).not.toBeInTheDocument()
    expect(screen.getByText('marketplace.loadError')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'operation.retry' }))
    expect(mockMarketplaceData.refetch).toHaveBeenCalledTimes(1)
  })
})
