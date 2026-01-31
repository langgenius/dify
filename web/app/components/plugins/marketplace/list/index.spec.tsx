import type { MarketplaceCollection, SearchParamsFromCollection } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import List from './index'
import ListWithCollection from './list-with-collection'
import ListWrapper from './list-wrapper'

// ================================
// Mock External Dependencies Only
// ================================

// Mock i18n translation hook
vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string, num?: number }) => {
      // Build full key with namespace prefix if provided
      const fullKey = options?.ns ? `${options.ns}.${key}` : key
      const translations: Record<string, string> = {
        'plugin.marketplace.viewMore': 'View More',
        'plugin.marketplace.pluginsResult': `${options?.num || 0} plugins found`,
        'plugin.marketplace.noPluginFound': 'No plugins found',
        'plugin.detailPanel.operation.install': 'Install',
        'plugin.detailPanel.operation.detail': 'Detail',
      }
      return translations[fullKey] || key
    },
  }),
  useLocale: () => 'en-US',
}))

// Mock marketplace state hooks with controllable values
const { mockMarketplaceData, mockMoreClick } = vi.hoisted(() => {
  return {
    mockMarketplaceData: {
      plugins: undefined as Plugin[] | undefined,
      pluginsTotal: 0,
      marketplaceCollections: undefined as MarketplaceCollection[] | undefined,
      marketplaceCollectionPluginsMap: undefined as Record<string, Plugin[]> | undefined,
      isLoading: false,
      page: 1,
    },
    mockMoreClick: vi.fn(),
  }
})

vi.mock('../state', () => ({
  useMarketplaceData: () => mockMarketplaceData,
}))

vi.mock('../atoms', () => ({
  useMarketplaceMoreClick: () => mockMoreClick,
}))

// Mock useLocale context
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}))

// Mock useTags hook
const mockTags = [
  { name: 'search', label: 'Search' },
  { name: 'image', label: 'Image' },
]

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: mockTags,
    tagsMap: mockTags.reduce((acc, tag) => {
      acc[tag.name] = tag
      return acc
    }, {} as Record<string, { name: string, label: string }>),
    getTagLabel: (name: string) => {
      const tag = mockTags.find(t => t.name === name)
      return tag?.label || name
    },
  }),
}))

// Mock ahooks useBoolean with controllable state
let mockUseBooleanValue = false
const mockSetTrue = vi.fn(() => {
  mockUseBooleanValue = true
})
const mockSetFalse = vi.fn(() => {
  mockUseBooleanValue = false
})

vi.mock('ahooks', () => ({
  useBoolean: (_defaultValue: boolean) => {
    return [
      mockUseBooleanValue,
      {
        setTrue: mockSetTrue,
        setFalse: mockSetFalse,
        toggle: vi.fn(),
      },
    ]
  },
}))

// Mock i18n-config/language
vi.mock('@/i18n-config/language', () => ({
  getLanguage: (locale: string) => locale || 'en-US',
}))

// Mock marketplace utils
vi.mock('../utils', () => ({
  getPluginLinkInMarketplace: (plugin: Plugin, _params?: Record<string, string | undefined>) =>
    `/plugins/${plugin.org}/${plugin.name}`,
  getPluginDetailLinkInMarketplace: (plugin: Plugin) =>
    `/plugins/${plugin.org}/${plugin.name}`,
}))

// Mock Card component
vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, footer }: { payload: Plugin, footer?: React.ReactNode }) => (
    <div data-testid={`card-${payload.name}`}>
      <div data-testid="card-name">{payload.name}</div>
      <div data-testid="card-label">{payload.label?.['en-US'] || payload.name}</div>
      {!!footer && <div data-testid="card-footer">{footer}</div>}
    </div>
  ),
}))

// Mock CardMoreInfo component
vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ downloadCount, tags }: { downloadCount: number, tags: string[] }) => (
    <div data-testid="card-more-info">
      <span data-testid="download-count">{downloadCount}</span>
      <span data-testid="tags">{tags.join(',')}</span>
    </div>
  ),
}))

// Mock InstallFromMarketplace component
vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="install-from-marketplace">
      <button onClick={onClose} data-testid="close-install-modal">Close</button>
    </div>
  ),
}))

// Mock SortDropdown component
vi.mock('../sort-dropdown', () => ({
  default: () => (
    <div data-testid="sort-dropdown">Sort</div>
  ),
}))

// Mock Empty component
vi.mock('../empty', () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="empty-component" className={className}>
      No plugins found
    </div>
  ),
}))

// Mock Loading component
vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading-component">Loading...</div>,
}))

// ================================
// Test Data Factories
// ================================

const createMockPlugin = (overrides?: Partial<Plugin>): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: `test-plugin-${Math.random().toString(36).substring(7)}`,
  plugin_id: `plugin-${Math.random().toString(36).substring(7)}`,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-org/test-plugin:1.0.0',
  icon: '/icon.png',
  verified: true,
  label: { 'en-US': 'Test Plugin' },
  brief: { 'en-US': 'Test plugin brief description' },
  description: { 'en-US': 'Test plugin full description' },
  introduction: 'Test plugin introduction',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 1000,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createMockPluginList = (count: number): Plugin[] =>
  Array.from({ length: count }, (_, i) =>
    createMockPlugin({
      name: `plugin-${i}`,
      plugin_id: `plugin-id-${i}`,
      label: { 'en-US': `Plugin ${i}` },
    }))

const createMockCollection = (overrides?: Partial<MarketplaceCollection>): MarketplaceCollection => ({
  name: `collection-${Math.random().toString(36).substring(7)}`,
  label: { 'en-US': 'Test Collection' },
  description: { 'en-US': 'Test collection description' },
  rule: 'test-rule',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  searchable: true,
  search_params: { query: 'test' },
  ...overrides,
})

const createMockCollectionList = (count: number): MarketplaceCollection[] =>
  Array.from({ length: count }, (_, i) =>
    createMockCollection({
      name: `collection-${i}`,
      label: { 'en-US': `Collection ${i}` },
      description: { 'en-US': `Description for collection ${i}` },
    }))

// ================================
// List Component Tests
// ================================
describe('List', () => {
  const defaultProps = {
    marketplaceCollections: [] as MarketplaceCollection[],
    marketplaceCollectionPluginsMap: {} as Record<string, Plugin[]>,
    plugins: undefined,
    showInstallButton: false,
    cardContainerClassName: '',
    cardRender: undefined,
    onMoreClick: undefined,
    emptyClassName: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<List {...defaultProps} />)

      // Component should render without errors
      expect(document.body).toBeInTheDocument()
    })

    it('should render ListWithCollection when plugins prop is undefined', () => {
      const collections = createMockCollectionList(2)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(2),
        'collection-1': createMockPluginList(3),
      }

      render(
        <List
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      // Should render collection titles
      expect(screen.getByText('Collection 0')).toBeInTheDocument()
      expect(screen.getByText('Collection 1')).toBeInTheDocument()
    })

    it('should render plugin cards when plugins array is provided', () => {
      const plugins = createMockPluginList(3)

      render(
        <List
          {...defaultProps}
          plugins={plugins}
        />,
      )

      // Should render plugin cards
      expect(screen.getByTestId('card-plugin-0')).toBeInTheDocument()
      expect(screen.getByTestId('card-plugin-1')).toBeInTheDocument()
      expect(screen.getByTestId('card-plugin-2')).toBeInTheDocument()
    })

    it('should render Empty component when plugins array is empty', () => {
      render(
        <List
          {...defaultProps}
          plugins={[]}
        />,
      )

      expect(screen.getByTestId('empty-component')).toBeInTheDocument()
    })

    it('should not render ListWithCollection when plugins is defined', () => {
      const collections = createMockCollectionList(2)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(2),
      }

      render(
        <List
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
          plugins={[]}
        />,
      )

      // Should not render collection titles
      expect(screen.queryByText('Collection 0')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Props Testing
  // ================================
  describe('Props', () => {
    it('should apply cardContainerClassName to grid container', () => {
      const plugins = createMockPluginList(2)
      const { container } = render(
        <List
          {...defaultProps}
          plugins={plugins}
          cardContainerClassName="custom-grid-class"
        />,
      )

      expect(container.querySelector('.custom-grid-class')).toBeInTheDocument()
    })

    it('should apply emptyClassName to Empty component', () => {
      render(
        <List
          {...defaultProps}
          plugins={[]}
          emptyClassName="custom-empty-class"
        />,
      )

      expect(screen.getByTestId('empty-component')).toHaveClass('custom-empty-class')
    })

    it('should pass showInstallButton to CardWrapper', () => {
      const plugins = createMockPluginList(1)

      const { container } = render(
        <List
          {...defaultProps}
          plugins={plugins}
          showInstallButton={true}
        />,
      )

      // CardWrapper should be rendered (via Card mock)
      expect(container.querySelector('[data-testid="card-plugin-0"]')).toBeInTheDocument()
    })
  })

  // ================================
  // Custom Card Render Tests
  // ================================
  describe('Custom Card Render', () => {
    it('should use cardRender function when provided', () => {
      const plugins = createMockPluginList(2)
      const customCardRender = (plugin: Plugin) => (
        <div key={plugin.name} data-testid={`custom-card-${plugin.name}`}>
          Custom:
          {' '}
          {plugin.name}
        </div>
      )

      render(
        <List
          {...defaultProps}
          plugins={plugins}
          cardRender={customCardRender}
        />,
      )

      expect(screen.getByTestId('custom-card-plugin-0')).toBeInTheDocument()
      expect(screen.getByTestId('custom-card-plugin-1')).toBeInTheDocument()
      expect(screen.getByText('Custom: plugin-0')).toBeInTheDocument()
    })

    it('should handle cardRender returning null', () => {
      const plugins = createMockPluginList(2)
      const customCardRender = (plugin: Plugin) => {
        if (plugin.name === 'plugin-0')
          return null
        return (
          <div key={plugin.name} data-testid={`custom-card-${plugin.name}`}>
            {plugin.name}
          </div>
        )
      }

      render(
        <List
          {...defaultProps}
          plugins={plugins}
          cardRender={customCardRender}
        />,
      )

      expect(screen.queryByTestId('custom-card-plugin-0')).not.toBeInTheDocument()
      expect(screen.getByTestId('custom-card-plugin-1')).toBeInTheDocument()
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty marketplaceCollections', () => {
      render(
        <List
          {...defaultProps}
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
        />,
      )

      // Should not throw and render nothing
      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined plugins correctly', () => {
      const collections = createMockCollectionList(1)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
      }

      render(
        <List
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
          plugins={undefined}
        />,
      )

      // Should render ListWithCollection
      expect(screen.getByText('Collection 0')).toBeInTheDocument()
    })

    it('should handle large number of plugins', () => {
      const plugins = createMockPluginList(100)

      const { container } = render(
        <List
          {...defaultProps}
          plugins={plugins}
        />,
      )

      // Should render all plugin cards
      const cards = container.querySelectorAll('[data-testid^="card-plugin-"]')
      expect(cards.length).toBe(100)
    })

    it('should handle plugins with special characters in name', () => {
      const specialPlugin = createMockPlugin({
        name: 'plugin-with-special-chars!@#',
        org: 'test-org',
      })

      render(
        <List
          {...defaultProps}
          plugins={[specialPlugin]}
        />,
      )

      expect(screen.getByTestId('card-plugin-with-special-chars!@#')).toBeInTheDocument()
    })
  })
})

// ================================
// ListWithCollection Component Tests
// ================================
describe('ListWithCollection', () => {
  const defaultProps = {
    marketplaceCollections: [] as MarketplaceCollection[],
    marketplaceCollectionPluginsMap: {} as Record<string, Plugin[]>,
    showInstallButton: false,
    cardContainerClassName: '',
    cardRender: undefined,
    onMoreClick: undefined,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ListWithCollection {...defaultProps} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render collection labels and descriptions', () => {
      const collections = createMockCollectionList(2)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
        'collection-1': createMockPluginList(1),
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      expect(screen.getByText('Collection 0')).toBeInTheDocument()
      expect(screen.getByText('Description for collection 0')).toBeInTheDocument()
      expect(screen.getByText('Collection 1')).toBeInTheDocument()
      expect(screen.getByText('Description for collection 1')).toBeInTheDocument()
    })

    it('should render plugin cards within collections', () => {
      const collections = createMockCollectionList(1)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(3),
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      expect(screen.getByTestId('card-plugin-0')).toBeInTheDocument()
      expect(screen.getByTestId('card-plugin-1')).toBeInTheDocument()
      expect(screen.getByTestId('card-plugin-2')).toBeInTheDocument()
    })

    it('should not render collections with no plugins', () => {
      const collections = createMockCollectionList(2)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
        'collection-1': [], // Empty plugins
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      expect(screen.getByText('Collection 0')).toBeInTheDocument()
      expect(screen.queryByText('Collection 1')).not.toBeInTheDocument()
    })
  })

  // ================================
  // View More Button Tests
  // ================================
  describe('View More Button', () => {
    it('should render View More button when collection is searchable', () => {
      const collections = [createMockCollection({
        name: 'collection-0',
        searchable: true,
        search_params: { query: 'test' },
      })]
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      expect(screen.getByText('View More')).toBeInTheDocument()
    })

    it('should not render View More button when collection is not searchable', () => {
      const collections = [createMockCollection({
        name: 'collection-0',
        searchable: false,
      })]
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      expect(screen.queryByText('View More')).not.toBeInTheDocument()
    })

    it('should call moreClick hook with search_params when View More is clicked', () => {
      const searchParams: SearchParamsFromCollection = { query: 'test-query', sort_by: 'install_count' }
      const collections = [createMockCollection({
        name: 'collection-0',
        searchable: true,
        search_params: searchParams,
      })]
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      fireEvent.click(screen.getByText('View More'))

      expect(mockMoreClick).toHaveBeenCalledTimes(1)
      expect(mockMoreClick).toHaveBeenCalledWith(searchParams)
    })
  })

  // ================================
  // Custom Card Render Tests
  // ================================
  describe('Custom Card Render', () => {
    it('should use cardRender function when provided', () => {
      const collections = createMockCollectionList(1)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(2),
      }
      const customCardRender = (plugin: Plugin) => (
        <div key={plugin.plugin_id} data-testid={`custom-${plugin.name}`}>
          Custom:
          {' '}
          {plugin.name}
        </div>
      )

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
          cardRender={customCardRender}
        />,
      )

      expect(screen.getByTestId('custom-plugin-0')).toBeInTheDocument()
      expect(screen.getByText('Custom: plugin-0')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Testing
  // ================================
  describe('Props', () => {
    it('should apply cardContainerClassName to grid', () => {
      const collections = createMockCollectionList(1)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
      }

      const { container } = render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
          cardContainerClassName="custom-container"
        />,
      )

      expect(container.querySelector('.custom-container')).toBeInTheDocument()
    })

    it('should pass showInstallButton to CardWrapper', () => {
      const collections = createMockCollectionList(1)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': createMockPluginList(1),
      }

      const { container } = render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
          showInstallButton={true}
        />,
      )

      // CardWrapper should be rendered
      expect(container.querySelector('[data-testid="card-plugin-0"]')).toBeInTheDocument()
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty collections array', () => {
      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
        />,
      )

      expect(document.body).toBeInTheDocument()
    })

    it('should handle missing plugins in map', () => {
      const collections = createMockCollectionList(1)
      // pluginsMap doesn't have the collection
      const pluginsMap: Record<string, Plugin[]> = {}

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      // Collection should not be rendered because it has no plugins
      expect(screen.queryByText('Collection 0')).not.toBeInTheDocument()
    })

    it('should handle undefined plugins in map', () => {
      const collections = createMockCollectionList(1)
      const pluginsMap: Record<string, Plugin[]> = {
        'collection-0': undefined as unknown as Plugin[],
      }

      render(
        <ListWithCollection
          {...defaultProps}
          marketplaceCollections={collections}
          marketplaceCollectionPluginsMap={pluginsMap}
        />,
      )

      // Collection should not be rendered
      expect(screen.queryByText('Collection 0')).not.toBeInTheDocument()
    })
  })
})

// ================================
// ListWrapper Component Tests
// ================================
describe('ListWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock data
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.pluginsTotal = 0
    mockMarketplaceData.marketplaceCollections = undefined
    mockMarketplaceData.marketplaceCollectionPluginsMap = undefined
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.page = 1
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ListWrapper />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render with scrollbarGutter style', () => {
      const { container } = render(<ListWrapper />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveStyle({ scrollbarGutter: 'stable' })
    })

    it('should render Loading component when isLoading is true and page is 1', () => {
      mockMarketplaceData.isLoading = true
      mockMarketplaceData.page = 1

      render(<ListWrapper />)

      expect(screen.getByTestId('loading-component')).toBeInTheDocument()
    })

    it('should not render Loading component when page > 1', () => {
      mockMarketplaceData.isLoading = true
      mockMarketplaceData.page = 2

      render(<ListWrapper />)

      expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Plugins Header Tests
  // ================================
  describe('Plugins Header', () => {
    it('should render plugins result count when plugins are present', () => {
      mockMarketplaceData.plugins = createMockPluginList(5)
      mockMarketplaceData.pluginsTotal = 5

      render(<ListWrapper />)

      expect(screen.getByText('5 plugins found')).toBeInTheDocument()
    })

    it('should render SortDropdown when plugins are present', () => {
      mockMarketplaceData.plugins = createMockPluginList(1)

      render(<ListWrapper />)

      expect(screen.getByTestId('sort-dropdown')).toBeInTheDocument()
    })

    it('should not render plugins header when plugins is undefined', () => {
      mockMarketplaceData.plugins = undefined

      render(<ListWrapper />)

      expect(screen.queryByTestId('sort-dropdown')).not.toBeInTheDocument()
    })
  })

  // ================================
  // List Rendering Logic Tests
  // ================================
  describe('List Rendering Logic', () => {
    it('should render collections when not loading', () => {
      mockMarketplaceData.isLoading = false
      mockMarketplaceData.marketplaceCollections = createMockCollectionList(1)
      mockMarketplaceData.marketplaceCollectionPluginsMap = {
        'collection-0': createMockPluginList(1),
      }

      render(<ListWrapper />)

      expect(screen.getByText('Collection 0')).toBeInTheDocument()
    })

    it('should render List when loading but page > 1', () => {
      mockMarketplaceData.isLoading = true
      mockMarketplaceData.page = 2
      mockMarketplaceData.marketplaceCollections = createMockCollectionList(1)
      mockMarketplaceData.marketplaceCollectionPluginsMap = {
        'collection-0': createMockPluginList(1),
      }

      render(<ListWrapper />)

      expect(screen.getByText('Collection 0')).toBeInTheDocument()
    })
  })

  // ================================
  // Data Integration Tests
  // ================================
  describe('Data Integration', () => {
    it('should pass plugins from state to List', () => {
      mockMarketplaceData.plugins = createMockPluginList(2)

      render(<ListWrapper />)

      expect(screen.getByTestId('card-plugin-0')).toBeInTheDocument()
      expect(screen.getByTestId('card-plugin-1')).toBeInTheDocument()
    })

    it('should show View More button and call moreClick hook', () => {
      mockMarketplaceData.marketplaceCollections = [createMockCollection({
        name: 'collection-0',
        searchable: true,
        search_params: { query: 'test' },
      })]
      mockMarketplaceData.marketplaceCollectionPluginsMap = {
        'collection-0': createMockPluginList(1),
      }

      render(<ListWrapper />)

      fireEvent.click(screen.getByText('View More'))

      expect(mockMoreClick).toHaveBeenCalled()
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty plugins array', () => {
      mockMarketplaceData.plugins = []
      mockMarketplaceData.pluginsTotal = 0

      render(<ListWrapper />)

      expect(screen.getByText('0 plugins found')).toBeInTheDocument()
      expect(screen.getByTestId('empty-component')).toBeInTheDocument()
    })

    it('should handle large pluginsTotal', () => {
      mockMarketplaceData.plugins = createMockPluginList(10)
      mockMarketplaceData.pluginsTotal = 10000

      render(<ListWrapper />)

      expect(screen.getByText('10000 plugins found')).toBeInTheDocument()
    })

    it('should handle both loading and has plugins', () => {
      mockMarketplaceData.isLoading = true
      mockMarketplaceData.page = 2
      mockMarketplaceData.plugins = createMockPluginList(5)
      mockMarketplaceData.pluginsTotal = 50

      render(<ListWrapper />)

      // Should show plugins header and list
      expect(screen.getByText('50 plugins found')).toBeInTheDocument()
      // Should not show loading because page > 1
      expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument()
    })
  })
})

// ================================
// CardWrapper Component Tests (via List integration)
// ================================
describe('CardWrapper (via List integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseBooleanValue = false
  })

  describe('Card Rendering', () => {
    it('should render Card with plugin data', () => {
      const plugin = createMockPlugin({
        name: 'test-plugin',
        label: { 'en-US': 'Test Plugin Label' },
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
        />,
      )

      expect(screen.getByTestId('card-test-plugin')).toBeInTheDocument()
    })

    it('should render CardMoreInfo with download count and tags', () => {
      const plugin = createMockPlugin({
        name: 'test-plugin',
        install_count: 5000,
        tags: [{ name: 'search' }, { name: 'image' }],
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
        />,
      )

      expect(screen.getByTestId('card-more-info')).toBeInTheDocument()
      expect(screen.getByTestId('download-count')).toHaveTextContent('5000')
    })
  })

  describe('Plugin Key Generation', () => {
    it('should use org/name as key for plugins', () => {
      const plugins = [
        createMockPlugin({ org: 'org1', name: 'plugin1' }),
        createMockPlugin({ org: 'org2', name: 'plugin2' }),
      ]

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={plugins}
        />,
      )

      expect(screen.getByTestId('card-plugin1')).toBeInTheDocument()
      expect(screen.getByTestId('card-plugin2')).toBeInTheDocument()
    })
  })

  // ================================
  // showInstallButton Branch Tests
  // ================================
  describe('showInstallButton=true branch', () => {
    it('should render install and detail buttons when showInstallButton is true', () => {
      const plugin = createMockPlugin({ name: 'install-test-plugin' })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={true}
        />,
      )

      // Should render the card
      expect(screen.getByTestId('card-install-test-plugin')).toBeInTheDocument()
      // Should render install button
      expect(screen.getByText('Install')).toBeInTheDocument()
      // Should render detail button
      expect(screen.getByText('Detail')).toBeInTheDocument()
    })

    it('should call showInstallFromMarketplace when install button is clicked', () => {
      const plugin = createMockPlugin({ name: 'click-test-plugin' })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={true}
        />,
      )

      const installButton = screen.getByText('Install')
      fireEvent.click(installButton)

      expect(mockSetTrue).toHaveBeenCalled()
    })

    it('should render detail link with correct href', () => {
      const plugin = createMockPlugin({
        name: 'link-test-plugin',
        org: 'test-org',
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={true}
        />,
      )

      const detailLink = screen.getByText('Detail').closest('a')
      expect(detailLink).toHaveAttribute('href', '/plugins/test-org/link-test-plugin')
      expect(detailLink).toHaveAttribute('target', '_blank')
    })

    it('should render InstallFromMarketplace modal when isShowInstallFromMarketplace is true', () => {
      mockUseBooleanValue = true
      const plugin = createMockPlugin({ name: 'modal-test-plugin' })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={true}
        />,
      )

      expect(screen.getByTestId('install-from-marketplace')).toBeInTheDocument()
    })

    it('should not render InstallFromMarketplace modal when isShowInstallFromMarketplace is false', () => {
      mockUseBooleanValue = false
      const plugin = createMockPlugin({ name: 'no-modal-test-plugin' })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={true}
        />,
      )

      expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
    })

    it('should call hideInstallFromMarketplace when modal close is triggered', () => {
      mockUseBooleanValue = true
      const plugin = createMockPlugin({ name: 'close-modal-plugin' })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={true}
        />,
      )

      const closeButton = screen.getByTestId('close-install-modal')
      fireEvent.click(closeButton)

      expect(mockSetFalse).toHaveBeenCalled()
    })
  })

  // ================================
  // showInstallButton=false Branch Tests
  // ================================
  describe('showInstallButton=false branch', () => {
    it('should render as a link when showInstallButton is false', () => {
      const plugin = createMockPlugin({
        name: 'link-plugin',
        org: 'test-org',
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={false}
        />,
      )

      // Should not render install/detail buttons
      expect(screen.queryByText('Install')).not.toBeInTheDocument()
      expect(screen.queryByText('Detail')).not.toBeInTheDocument()
    })

    it('should render card within link for non-install mode', () => {
      const plugin = createMockPlugin({
        name: 'card-link-plugin',
        org: 'card-org',
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
          showInstallButton={false}
        />,
      )

      expect(screen.getByTestId('card-card-link-plugin')).toBeInTheDocument()
    })

    it('should render with undefined showInstallButton (default false)', () => {
      const plugin = createMockPlugin({ name: 'default-plugin' })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
        />,
      )

      // Should not render install button (default behavior)
      expect(screen.queryByText('Install')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Tag Labels Memoization Tests
  // ================================
  describe('Tag Labels', () => {
    it('should render tag labels correctly', () => {
      const plugin = createMockPlugin({
        name: 'tag-plugin',
        tags: [{ name: 'search' }, { name: 'image' }],
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
        />,
      )

      expect(screen.getByTestId('tags')).toHaveTextContent('Search,Image')
    })

    it('should handle empty tags array', () => {
      const plugin = createMockPlugin({
        name: 'no-tags-plugin',
        tags: [],
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
        />,
      )

      expect(screen.getByTestId('tags')).toHaveTextContent('')
    })

    it('should handle unknown tag names', () => {
      const plugin = createMockPlugin({
        name: 'unknown-tag-plugin',
        tags: [{ name: 'unknown-tag' }],
      })

      render(
        <List
          marketplaceCollections={[]}
          marketplaceCollectionPluginsMap={{}}
          plugins={[plugin]}
        />,
      )

      // Unknown tags should show the original name
      expect(screen.getByTestId('tags')).toHaveTextContent('unknown-tag')
    })
  })
})

// ================================
// Combined Workflow Tests
// ================================
describe('Combined Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.pluginsTotal = 0
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.page = 1
    mockMarketplaceData.marketplaceCollections = undefined
    mockMarketplaceData.marketplaceCollectionPluginsMap = undefined
  })

  it('should transition from loading to showing collections', async () => {
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 1

    const { rerender } = render(<ListWrapper />)

    expect(screen.getByTestId('loading-component')).toBeInTheDocument()

    // Simulate loading complete
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.marketplaceCollections = createMockCollectionList(1)
    mockMarketplaceData.marketplaceCollectionPluginsMap = {
      'collection-0': createMockPluginList(1),
    }

    rerender(<ListWrapper />)

    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument()
    expect(screen.getByText('Collection 0')).toBeInTheDocument()
  })

  it('should transition from collections to search results', async () => {
    mockMarketplaceData.marketplaceCollections = createMockCollectionList(1)
    mockMarketplaceData.marketplaceCollectionPluginsMap = {
      'collection-0': createMockPluginList(1),
    }

    const { rerender } = render(<ListWrapper />)

    expect(screen.getByText('Collection 0')).toBeInTheDocument()

    // Simulate search results
    mockMarketplaceData.plugins = createMockPluginList(5)
    mockMarketplaceData.pluginsTotal = 5

    rerender(<ListWrapper />)

    expect(screen.queryByText('Collection 0')).not.toBeInTheDocument()
    expect(screen.getByText('5 plugins found')).toBeInTheDocument()
  })

  it('should handle empty search results', () => {
    mockMarketplaceData.plugins = []
    mockMarketplaceData.pluginsTotal = 0

    render(<ListWrapper />)

    expect(screen.getByTestId('empty-component')).toBeInTheDocument()
    expect(screen.getByText('0 plugins found')).toBeInTheDocument()
  })

  it('should support pagination (page > 1)', () => {
    mockMarketplaceData.plugins = createMockPluginList(40)
    mockMarketplaceData.pluginsTotal = 80
    mockMarketplaceData.isLoading = true
    mockMarketplaceData.page = 2

    render(<ListWrapper />)

    // Should show existing results while loading more
    expect(screen.getByText('80 plugins found')).toBeInTheDocument()
    // Should not show loading spinner for pagination
    expect(screen.queryByTestId('loading-component')).not.toBeInTheDocument()
  })
})

// ================================
// Accessibility Tests
// ================================
describe('Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketplaceData.plugins = undefined
    mockMarketplaceData.isLoading = false
    mockMarketplaceData.page = 1
  })

  it('should have semantic structure with collections', () => {
    const collections = createMockCollectionList(1)
    const pluginsMap: Record<string, Plugin[]> = {
      'collection-0': createMockPluginList(1),
    }

    const { container } = render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
      />,
    )

    // Should have proper heading structure
    const headings = container.querySelectorAll('.title-xl-semi-bold')
    expect(headings.length).toBeGreaterThan(0)
  })

  it('should have clickable View More button', () => {
    const collections = [createMockCollection({
      name: 'collection-0',
      searchable: true,
    })]
    const pluginsMap: Record<string, Plugin[]> = {
      'collection-0': createMockPluginList(1),
    }

    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
      />,
    )

    const viewMoreButton = screen.getByText('View More')
    expect(viewMoreButton).toBeInTheDocument()
    expect(viewMoreButton.closest('div')).toHaveClass('cursor-pointer')
  })

  it('should have proper grid layout for cards', () => {
    const plugins = createMockPluginList(4)

    const { container } = render(
      <List
        marketplaceCollections={[]}
        marketplaceCollectionPluginsMap={{}}
        plugins={plugins}
      />,
    )

    const grid = container.querySelector('.grid-cols-4')
    expect(grid).toBeInTheDocument()
  })
})

// ================================
// Performance Tests
// ================================
describe('Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should handle rendering many plugins efficiently', () => {
    const plugins = createMockPluginList(50)

    const startTime = performance.now()
    render(
      <List
        marketplaceCollections={[]}
        marketplaceCollectionPluginsMap={{}}
        plugins={plugins}
      />,
    )
    const endTime = performance.now()

    // Should render in reasonable time (less than 1 second)
    expect(endTime - startTime).toBeLessThan(1000)
  })

  it('should handle rendering many collections efficiently', () => {
    const collections = createMockCollectionList(10)
    const pluginsMap: Record<string, Plugin[]> = {}
    collections.forEach((collection) => {
      pluginsMap[collection.name] = createMockPluginList(5)
    })

    const startTime = performance.now()
    render(
      <ListWithCollection
        marketplaceCollections={collections}
        marketplaceCollectionPluginsMap={pluginsMap}
      />,
    )
    const endTime = performance.now()

    // Should render in reasonable time (less than 1 second)
    expect(endTime - startTime).toBeLessThan(1000)
  })
})
