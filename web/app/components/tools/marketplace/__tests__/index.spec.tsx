import type { useMarketplace } from '../hooks'
import type { Plugin } from '@/app/components/plugins/types'
import type { Collection } from '@/app/components/tools/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { getMarketplaceUrl } from '@/utils/var'

import Marketplace from '../index'

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

const mockGetMarketplaceUrl = vi.mocked(getMarketplaceUrl)

const _createToolProvider = (overrides: Partial<Collection> = {}): Collection => ({
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
        theme: undefined,
      })
      const marketplaceLink = screen.getByRole('link', { name: /plugin.marketplace.difyMarketplace/i })
      expect(marketplaceLink).toHaveAttribute('href', 'https://marketplace.test/market')
    })
  })
})

// useMarketplace hook tests moved to hooks.spec.ts
