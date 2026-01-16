import type { Plugin } from '@/app/components/plugins/types'
import type { Collection } from '@/app/components/tools/types'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { SCROLL_BOTTOM_THRESHOLD } from '@/app/components/plugins/marketplace/constants'
import { getMarketplaceListCondition } from '@/app/components/plugins/marketplace/utils'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { getMarketplaceUrl } from '@/utils/var'
import { useMarketplace } from './hooks'

import Marketplace from './index'

const listRenderSpy = vi.fn()
vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: (props: {
    marketplaceCollections: unknown[]
    marketplaceCollectionPluginsMap: Record<string, unknown[]>
    plugins?: unknown[]
    showInstallButton?: boolean
  }) => {
    listRenderSpy(props)
    return <div data-testid="marketplace-list" />
  },
}))

const mockUseMarketplaceCollectionsAndPlugins = vi.fn()
const mockUseMarketplacePlugins = vi.fn()
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplaceCollectionsAndPlugins: (...args: unknown[]) => mockUseMarketplaceCollectionsAndPlugins(...args),
  useMarketplacePlugins: (...args: unknown[]) => mockUseMarketplacePlugins(...args),
}))

const mockUseAllToolProviders = vi.fn()
vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: (...args: unknown[]) => mockUseAllToolProviders(...args),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: vi.fn(() => 'https://marketplace.test/market'),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

const mockGetMarketplaceUrl = vi.mocked(getMarketplaceUrl)

const createToolProvider = (overrides: Partial<Collection> = {}): Collection => ({
  id: 'provider-1',
  name: 'Provider 1',
  author: 'Author',
  description: { en_US: 'desc', zh_Hans: '描述' },
  icon: 'icon',
  label: { en_US: 'label', zh_Hans: '标签' },
  type: CollectionType.custom,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  ...overrides,
})

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'org',
  author: 'author',
  name: 'Plugin One',
  plugin_id: 'plugin-1',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'plugin-1@1.0.0',
  icon: 'icon',
  verified: true,
  label: { en_US: 'Plugin One' },
  brief: { en_US: 'Brief' },
  description: { en_US: 'Plugin description' },
  introduction: 'Intro',
  repository: 'https://example.com',
  category: PluginCategoryEnum.tool,
  install_count: 0,
  endpoint: { settings: [] },
  tags: [{ name: 'tag' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createMarketplaceContext = (overrides: Partial<ReturnType<typeof useMarketplace>> = {}) => ({
  isLoading: false,
  marketplaceCollections: [],
  marketplaceCollectionPluginsMap: {},
  plugins: [],
  handleScroll: vi.fn(),
  page: 1,
  ...overrides,
})

describe('Marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering the marketplace panel based on loading and visibility state.
  describe('Rendering', () => {
    it('should show loading indicator when loading first page', () => {
      // Arrange
      const marketplaceContext = createMarketplaceContext({ isLoading: true, page: 1 })
      render(
        <Marketplace
          searchPluginText=""
          filterPluginTags={[]}
          isMarketplaceArrowVisible={false}
          showMarketplacePanel={vi.fn()}
          marketplaceContext={marketplaceContext}
        />,
      )

      // Assert
      expect(document.querySelector('svg.spin-animation')).toBeInTheDocument()
      expect(screen.queryByTestId('marketplace-list')).not.toBeInTheDocument()
    })

    it('should render list when not loading', () => {
      // Arrange
      const marketplaceContext = createMarketplaceContext({
        isLoading: false,
        plugins: [createPlugin()],
      })
      render(
        <Marketplace
          searchPluginText=""
          filterPluginTags={[]}
          isMarketplaceArrowVisible={false}
          showMarketplacePanel={vi.fn()}
          marketplaceContext={marketplaceContext}
        />,
      )

      // Assert
      expect(screen.getByTestId('marketplace-list')).toBeInTheDocument()
      expect(listRenderSpy).toHaveBeenCalledWith(expect.objectContaining({
        showInstallButton: true,
      }))
    })
  })

  // Prop-driven UI output such as links and action triggers.
  describe('Props', () => {
    it('should build marketplace link and trigger panel when arrow is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      const marketplaceContext = createMarketplaceContext()
      const showMarketplacePanel = vi.fn()
      const { container } = render(
        <Marketplace
          searchPluginText="vector"
          filterPluginTags={['tag-a', 'tag-b']}
          isMarketplaceArrowVisible
          showMarketplacePanel={showMarketplacePanel}
          marketplaceContext={marketplaceContext}
        />,
      )

      // Act
      const arrowIcon = container.querySelector('svg.cursor-pointer')
      expect(arrowIcon).toBeTruthy()
      await user.click(arrowIcon as SVGElement)

      // Assert
      expect(showMarketplacePanel).toHaveBeenCalledTimes(1)
      expect(mockGetMarketplaceUrl).toHaveBeenCalledWith('', {
        language: 'en',
        q: 'vector',
        tags: 'tag-a,tag-b',
        theme: 'light',
      })
      const marketplaceLink = screen.getByRole('link', { name: /plugin.marketplace.difyMarketplace/i })
      expect(marketplaceLink).toHaveAttribute('href', 'https://marketplace.test/market')
    })
  })
})

describe('useMarketplace', () => {
  const mockQueryMarketplaceCollectionsAndPlugins = vi.fn()
  const mockQueryPlugins = vi.fn()
  const mockQueryPluginsWithDebounced = vi.fn()
  const mockResetPlugins = vi.fn()
  const mockFetchNextPage = vi.fn()

  const setupHookMocks = (overrides?: {
    isLoading?: boolean
    isPluginsLoading?: boolean
    pluginsPage?: number
    hasNextPage?: boolean
    plugins?: Plugin[] | undefined
  }) => {
    mockUseMarketplaceCollectionsAndPlugins.mockReturnValue({
      isLoading: overrides?.isLoading ?? false,
      marketplaceCollections: [],
      marketplaceCollectionPluginsMap: {},
      queryMarketplaceCollectionsAndPlugins: mockQueryMarketplaceCollectionsAndPlugins,
    })
    mockUseMarketplacePlugins.mockReturnValue({
      plugins: overrides?.plugins,
      resetPlugins: mockResetPlugins,
      queryPlugins: mockQueryPlugins,
      queryPluginsWithDebounced: mockQueryPluginsWithDebounced,
      isLoading: overrides?.isPluginsLoading ?? false,
      fetchNextPage: mockFetchNextPage,
      hasNextPage: overrides?.hasNextPage ?? false,
      page: overrides?.pluginsPage,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAllToolProviders.mockReturnValue({
      data: [],
      isSuccess: true,
    })
    setupHookMocks()
  })

  // Query behavior driven by search filters and provider exclusions.
  describe('Queries', () => {
    it('should query plugins with debounce when search text is provided', async () => {
      // Arrange
      mockUseAllToolProviders.mockReturnValue({
        data: [
          createToolProvider({ plugin_id: 'plugin-a' }),
          createToolProvider({ plugin_id: undefined }),
        ],
        isSuccess: true,
      })

      // Act
      renderHook(() => useMarketplace('alpha', []))

      // Assert
      await waitFor(() => {
        expect(mockQueryPluginsWithDebounced).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          query: 'alpha',
          tags: [],
          exclude: ['plugin-a'],
          type: 'plugin',
        })
      })
      expect(mockQueryMarketplaceCollectionsAndPlugins).not.toHaveBeenCalled()
      expect(mockResetPlugins).not.toHaveBeenCalled()
    })

    it('should query plugins immediately when only tags are provided', async () => {
      // Arrange
      mockUseAllToolProviders.mockReturnValue({
        data: [createToolProvider({ plugin_id: 'plugin-b' })],
        isSuccess: true,
      })

      // Act
      renderHook(() => useMarketplace('', ['tag-1']))

      // Assert
      await waitFor(() => {
        expect(mockQueryPlugins).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          query: '',
          tags: ['tag-1'],
          exclude: ['plugin-b'],
          type: 'plugin',
        })
      })
    })

    it('should query collections and reset plugins when no filters are provided', async () => {
      // Arrange
      mockUseAllToolProviders.mockReturnValue({
        data: [createToolProvider({ plugin_id: 'plugin-c' })],
        isSuccess: true,
      })

      // Act
      renderHook(() => useMarketplace('', []))

      // Assert
      await waitFor(() => {
        expect(mockQueryMarketplaceCollectionsAndPlugins).toHaveBeenCalledWith({
          category: PluginCategoryEnum.tool,
          condition: getMarketplaceListCondition(PluginCategoryEnum.tool),
          exclude: ['plugin-c'],
          type: 'plugin',
        })
      })
      expect(mockResetPlugins).toHaveBeenCalledTimes(1)
    })
  })

  // State derived from hook inputs and loading signals.
  describe('State', () => {
    it('should expose combined loading state and fallback page value', () => {
      // Arrange
      setupHookMocks({ isLoading: true, isPluginsLoading: false, pluginsPage: undefined })

      // Act
      const { result } = renderHook(() => useMarketplace('', []))

      // Assert
      expect(result.current.isLoading).toBe(true)
      expect(result.current.page).toBe(1)
    })
  })

  // Scroll handling that triggers pagination when appropriate.
  describe('Scroll', () => {
    it('should fetch next page when scrolling near bottom with filters', () => {
      // Arrange
      setupHookMocks({ hasNextPage: true })
      const { result } = renderHook(() => useMarketplace('search', []))
      const event = {
        target: {
          scrollTop: 100,
          scrollHeight: 200,
          clientHeight: 100 + SCROLL_BOTTOM_THRESHOLD,
        },
      } as unknown as Event

      // Act
      act(() => {
        result.current.handleScroll(event)
      })

      // Assert
      expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
    })

    it('should not fetch next page when no filters are applied', () => {
      // Arrange
      setupHookMocks({ hasNextPage: true })
      const { result } = renderHook(() => useMarketplace('', []))
      const event = {
        target: {
          scrollTop: 100,
          scrollHeight: 200,
          clientHeight: 100 + SCROLL_BOTTOM_THRESHOLD,
        },
      } as unknown as Event

      // Act
      act(() => {
        result.current.handleScroll(event)
      })

      // Assert
      expect(mockFetchNextPage).not.toHaveBeenCalled()
    })
  })
})
