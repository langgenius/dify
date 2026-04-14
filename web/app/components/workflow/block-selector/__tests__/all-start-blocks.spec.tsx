import type { TriggerWithProvider } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { CollectionType } from '@/app/components/tools/types'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetLanguage, useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { useFeaturedTriggersRecommendations } from '@/service/use-plugins'
import { useAllTriggerPlugins, useInvalidateAllTriggerPlugins } from '@/service/use-triggers'
import { Theme } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import { useAvailableNodesMetaData } from '../../../workflow-app/hooks'
import useNodes from '../../store/workflow/use-nodes'
import { BlockEnum } from '../../types'
import AllStartBlocks from '../all-start-blocks'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
  useLocale: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: vi.fn(),
  useInvalidateAllTriggerPlugins: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedTriggersRecommendations: vi.fn(),
}))

vi.mock('../../store/workflow/use-nodes', () => ({
  default: vi.fn(),
}))

vi.mock('../../../workflow-app/hooks', () => ({
  useAvailableNodesMetaData: vi.fn(),
}))

vi.mock('@/utils/var', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/var')>()
  return {
    ...actual,
    getMarketplaceUrl: () => 'https://marketplace.test/start',
  }
})

const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseLocale = vi.mocked(useLocale)
const mockUseTheme = vi.mocked(useTheme)
const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)
const mockUseAllTriggerPlugins = vi.mocked(useAllTriggerPlugins)
const mockUseInvalidateAllTriggerPlugins = vi.mocked(useInvalidateAllTriggerPlugins)
const mockUseFeaturedTriggersRecommendations = vi.mocked(useFeaturedTriggersRecommendations)
const mockUseNodes = vi.mocked(useNodes)
const mockUseAvailableNodesMetaData = vi.mocked(useAvailableNodesMetaData)

type UseMarketplacePluginsReturn = ReturnType<typeof useMarketplacePlugins>
type UseAllTriggerPluginsReturn = ReturnType<typeof useAllTriggerPlugins>
type UseFeaturedTriggersRecommendationsReturn = ReturnType<typeof useFeaturedTriggersRecommendations>

const createTriggerProvider = (overrides: Partial<TriggerWithProvider> = {}): TriggerWithProvider => ({
  id: 'provider-1',
  name: 'provider-one',
  author: 'Provider Author',
  description: { en_US: 'desc', zh_Hans: '描述' },
  icon: 'icon',
  icon_dark: 'icon-dark',
  label: { en_US: 'Provider One', zh_Hans: '提供商一' },
  type: CollectionType.trigger,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'plugin-1@1.0.0',
  meta: { version: '1.0.0' },
  credentials_schema: [],
  subscription_constructor: null,
  subscription_schema: [],
  supported_creation_methods: [],
  events: [
    {
      name: 'created',
      author: 'Provider Author',
      label: { en_US: 'Created', zh_Hans: '创建' },
      description: { en_US: 'Created event', zh_Hans: '创建事件' },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
  ...overrides,
})

const createSystemFeatures = (enableMarketplace: boolean) => ({
  ...defaultSystemFeatures,
  enable_marketplace: enableMarketplace,
})

const createGlobalPublicStoreState = (enableMarketplace: boolean) => ({
  systemFeatures: createSystemFeatures(enableMarketplace),
  setSystemFeatures: vi.fn(),
})

const createMarketplacePluginsMock = (
  overrides: Partial<UseMarketplacePluginsReturn> = {},
): UseMarketplacePluginsReturn => ({
  plugins: [],
  total: 0,
  resetPlugins: vi.fn(),
  queryPlugins: vi.fn(),
  queryPluginsWithDebounced: vi.fn(),
  cancelQueryPluginsWithDebounced: vi.fn(),
  isLoading: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  page: 0,
  ...overrides,
})

const createTriggerPluginsQueryResult = (
  data: TriggerWithProvider[],
): UseAllTriggerPluginsReturn => ({
  data,
  error: null,
  isError: false,
  isPending: false,
  isLoading: false,
  isSuccess: true,
  isFetching: false,
  isRefetching: false,
  isLoadingError: false,
  isRefetchError: false,
  isInitialLoading: false,
  isPaused: false,
  isEnabled: true,
  status: 'success',
  fetchStatus: 'idle',
  dataUpdatedAt: Date.now(),
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  errorUpdateCount: 0,
  isFetched: true,
  isFetchedAfterMount: true,
  isPlaceholderData: false,
  isStale: false,
  refetch: vi.fn(),
  promise: Promise.resolve(data),
} as UseAllTriggerPluginsReturn)

const createFeaturedTriggersRecommendationsMock = (
  overrides: Partial<UseFeaturedTriggersRecommendationsReturn> = {},
): UseFeaturedTriggersRecommendationsReturn => ({
  plugins: [],
  isLoading: false,
  ...overrides,
})

const createAvailableNodesMetaData = (): ReturnType<typeof useAvailableNodesMetaData> => ({
  nodes: [],
} as unknown as ReturnType<typeof useAvailableNodesMetaData>)

describe('AllStartBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGlobalPublicStore.mockImplementation(selector => selector(createGlobalPublicStoreState(false)))
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseLocale.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock())
    mockUseAllTriggerPlugins.mockReturnValue(createTriggerPluginsQueryResult([createTriggerProvider()]))
    mockUseInvalidateAllTriggerPlugins.mockReturnValue(vi.fn())
    mockUseFeaturedTriggersRecommendations.mockReturnValue(createFeaturedTriggersRecommendationsMock())
    mockUseNodes.mockReturnValue([])
    mockUseAvailableNodesMetaData.mockReturnValue(createAvailableNodesMetaData())
  })

  // The combined start tab should merge built-in blocks, trigger plugins, and marketplace states.
  describe('Content Rendering', () => {
    it('should render start blocks and trigger plugin actions', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <AllStartBlocks
          searchText=""
          onSelect={onSelect}
          availableBlocksTypes={[BlockEnum.Start, BlockEnum.TriggerPlugin]}
          allowUserInputSelection
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('workflow.tabs.allTriggers')).toBeInTheDocument()
      })

      expect(screen.getByText('workflow.blocks.start')).toBeInTheDocument()
      expect(screen.getByText('Provider One')).toBeInTheDocument()

      await user.click(screen.getByText('workflow.blocks.start'))
      expect(onSelect).toHaveBeenCalledWith(BlockEnum.Start)

      await user.click(screen.getByText('Provider One'))
      await user.click(screen.getByText('Created'))

      expect(onSelect).toHaveBeenCalledWith(BlockEnum.TriggerPlugin, expect.objectContaining({
        provider_id: 'provider-one',
        event_name: 'created',
      }))
    })

    it('should show marketplace footer when marketplace is enabled without filters', async () => {
      mockUseGlobalPublicStore.mockImplementation(selector => selector(createGlobalPublicStoreState(true)))

      render(
        <AllStartBlocks
          searchText=""
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.TriggerPlugin]}
        />,
      )

      expect(await screen.findByRole('link', { name: /plugin\.findMoreInMarketplace/ })).toHaveAttribute('href', 'https://marketplace.test/start')
    })
  })

  // Empty filter states should surface the request-to-community fallback.
  describe('Filtered Empty State', () => {
    it('should query marketplace and show the no-results state when filters have no matches', async () => {
      const queryPluginsWithDebounced = vi.fn()
      mockUseGlobalPublicStore.mockImplementation(selector => selector(createGlobalPublicStoreState(true)))
      mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock({
        queryPluginsWithDebounced,
      }))
      mockUseAllTriggerPlugins.mockReturnValue(createTriggerPluginsQueryResult([]))

      render(
        <AllStartBlocks
          searchText="missing"
          tags={['webhook']}
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.TriggerPlugin]}
        />,
      )

      await waitFor(() => {
        expect(queryPluginsWithDebounced).toHaveBeenCalledWith({
          query: 'missing',
          tags: ['webhook'],
          category: 'trigger',
        })
      })

      expect(screen.getByText('workflow.tabs.noPluginsFound')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'workflow.tabs.requestToCommunity' })).toHaveAttribute(
        'href',
        'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
      )
    })
  })
})
