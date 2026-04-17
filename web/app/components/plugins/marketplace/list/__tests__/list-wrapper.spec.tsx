import type { MarketplaceCollection } from '../../types'
import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListWrapper from '../list-wrapper'

const mockMarketplaceData = vi.hoisted(() => ({
  plugins: undefined as Plugin[] | undefined,
  pluginsTotal: 0,
  marketplaceCollections: [] as MarketplaceCollection[],
  marketplaceCollectionPluginsMap: {} as Record<string, Plugin[]>,
  isLoading: false,
  isFetchingNextPage: false,
  page: 1,
}))

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string, num?: number }) =>
      key === 'marketplace.pluginsResult' && options?.ns === 'plugin'
        ? `${options.num} plugins found`
        : options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('../../state', () => ({
  useMarketplaceData: () => mockMarketplaceData,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: ({ className }: { className?: string }) => <div data-testid="loading" className={className}>loading</div>,
}))

vi.mock('../../sort-dropdown', () => ({
  default: () => <div data-testid="sort-dropdown">sort</div>,
}))

vi.mock('../index', () => ({
  default: ({ plugins }: { plugins?: Plugin[] }) => <div data-testid="list">{plugins?.length ?? 'collections'}</div>,
}))

describe('ListWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.pluginsTotal = 0
    mockMarketplaceData.marketplaceCollections = []
    mockMarketplaceData.marketplaceCollectionPluginsMap = {}
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.isFetchingNextPage = false
    mockMarketplaceData.page = 1
  })

  it('shows result header and sort dropdown when plugins are loaded', () => {
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]
    mockMarketplaceData.pluginsTotal = 1

    render(<ListWrapper />)

    expect(screen.getByText('1 plugins found')).toBeInTheDocument()
    expect(screen.getByTestId('sort-dropdown')).toBeInTheDocument()
  })

  it('shows centered loading only on initial loading page', () => {
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 1

    render(<ListWrapper />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByTestId('list')).not.toBeInTheDocument()
  })

  it('renders list when loading additional pages', () => {
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 2
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]

    render(<ListWrapper showInstallButton />)

    expect(screen.getByTestId('list')).toBeInTheDocument()
  })

  it('shows bottom loading indicator while fetching next page', () => {
    mockMarketplaceData.plugins = [{ plugin_id: 'p1', name: 'Plugin One' } as Plugin]
    mockMarketplaceData.isFetchingNextPage = true

    render(<ListWrapper />)

    expect(screen.getAllByTestId('loading')).toHaveLength(1)
  })
})
