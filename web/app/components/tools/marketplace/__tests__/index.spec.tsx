import type { SearchParamsFromCollection } from '@dify/contracts/marketplace'
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

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}))

const { mockCanInstallPlugin } = vi.hoisted(() => ({
  mockCanInstallPlugin: vi.fn(() => true),
}))

const listRenderSpy = vi.fn()
vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: (props: {
    marketplaceCollections: unknown[]
    marketplaceCollectionPluginsMap: Record<string, unknown[]>
    cardContainerClassName?: string
    plugins?: unknown[]
    showInstallButton?: boolean
    onCollectionMoreClick?: (searchParams?: SearchParamsFromCollection) => void
  }) => {
    listRenderSpy(props)
    return <div data-testid="marketplace-list" />
  },
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({
    canInstallPlugin: mockCanInstallPlugin(),
  }),
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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

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
    mockCanInstallPlugin.mockReturnValue(true)
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
        cardContainerClassName: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3',
        onCollectionMoreClick: expect.any(Function),
        showInstallButton: true,
      }))
    })

    it('should hide install actions when plugin install permission is missing', () => {
      mockCanInstallPlugin.mockReturnValue(false)
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

      expect(listRenderSpy).toHaveBeenCalledWith(expect.objectContaining({
        showInstallButton: false,
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
        language: 'en-US',
        q: 'vector',
        tags: 'tag-a,tag-b',
        theme: undefined,
      })
      const marketplaceLink = screen.getByRole('link', { name: /plugin.marketplace.difyMarketplace/i })
      expect(marketplaceLink).toHaveAttribute('href', 'https://marketplace.test/market')
    })

    it('should use compact content inset when requested by parent layout', () => {
      const marketplaceContext = createMarketplaceContext()
      const { container } = render(
        <Marketplace
          searchPluginText=""
          filterPluginTags={[]}
          isMarketplaceArrowVisible={false}
          showMarketplacePanel={vi.fn()}
          marketplaceContext={marketplaceContext}
          contentInset="compact"
        />,
      )

      const contentFrames = Array.from(container.querySelectorAll('div'))
        .filter(el => el.classList.contains('max-w-[1600px]'))
      expect(contentFrames).toHaveLength(2)
      expect(contentFrames[0]).toHaveClass('px-6')
      expect(contentFrames[1]).toHaveClass('px-6')
    })

    it('should open integrations marketplace when collection more is clicked', () => {
      const marketplaceContext = createMarketplaceContext()
      render(
        <Marketplace
          searchPluginText=""
          filterPluginTags={[]}
          isMarketplaceArrowVisible={false}
          showMarketplacePanel={vi.fn()}
          marketplaceContext={marketplaceContext}
        />,
      )

      const props = listRenderSpy.mock.calls[0]![0] as {
        onCollectionMoreClick: (searchParams?: SearchParamsFromCollection) => void
      }
      props.onCollectionMoreClick({
        query: 'featured tools',
        sort_by: 'install_count',
        sort_order: 'DESC',
      })

      expect(mockRouterPush).toHaveBeenCalledWith('/marketplace?category=tool&q=featured+tools&sort_by=install_count&sort_order=DESC')
    })
  })
})

// useMarketplace hook tests moved to hooks.spec.ts
