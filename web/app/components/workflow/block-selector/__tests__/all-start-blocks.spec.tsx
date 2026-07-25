import type { ReactElement } from 'react'
import type { TriggerWithProvider } from '../types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage, useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { useFeaturedTriggersRecommendations } from '@/service/use-plugins'
import { useAllTriggerPlugins, useInvalidateAllTriggerPlugins } from '@/service/use-triggers'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { Theme } from '@/types/app'
import { useAvailableNodesMetaData } from '../../../workflow-app/hooks'
import useNodes from '../../store/workflow/use-nodes'
import { BlockEnum } from '../../types'
import AllStartBlocks from '../all-start-blocks'
import { createPlugin } from './factories'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
  useLocale: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
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
    getMarketplaceUrl: (path = '', params?: Record<string, string | undefined>) => {
      const searchParams = new URLSearchParams()
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value) searchParams.set(key, value)
      })
      const query = searchParams.toString()
      return `https://marketplace.test${path}${query ? `?${query}` : ''}`
    },
  }
})

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
type UseFeaturedTriggersRecommendationsReturn = ReturnType<
  typeof useFeaturedTriggersRecommendations
>

const createTriggerProvider = (
  overrides: Partial<TriggerWithProvider> = {},
): TriggerWithProvider => ({
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

let enableMarketplaceForRender = false
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { enable_marketplace: enableMarketplaceForRender },
  })

const createMarketplacePluginsMock = (
  plugins: ReturnType<typeof createPlugin>[] = [],
): UseMarketplacePluginsReturn =>
  ({
    data: plugins.length
      ? {
          pages: [{ plugins, page: 1, page_size: 40, total: plugins.length }],
          pageParams: [1],
        }
      : undefined,
  }) as UseMarketplacePluginsReturn

const createTriggerPluginsQueryResult = (data: TriggerWithProvider[]): UseAllTriggerPluginsReturn =>
  ({
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
  }) as UseAllTriggerPluginsReturn

const createFeaturedTriggersRecommendationsMock = (
  overrides: Partial<UseFeaturedTriggersRecommendationsReturn> = {},
): UseFeaturedTriggersRecommendationsReturn => ({
  plugins: [],
  isLoading: false,
  ...overrides,
})

const createAvailableNodesMetaData = (): ReturnType<typeof useAvailableNodesMetaData> =>
  ({
    nodes: [],
  }) as unknown as ReturnType<typeof useAvailableNodesMetaData>

describe('AllStartBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enableMarketplaceForRender = false
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseLocale.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock())
    mockUseAllTriggerPlugins.mockReturnValue(
      createTriggerPluginsQueryResult([createTriggerProvider()]),
    )
    mockUseInvalidateAllTriggerPlugins.mockReturnValue(vi.fn())
    mockUseFeaturedTriggersRecommendations.mockReturnValue(
      createFeaturedTriggersRecommendationsMock(),
    )
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
        expect(screen.getByText('workflow.blocks.start')).toBeInTheDocument()
      })

      expect(screen.getByText('workflow.blocks.start')).toBeInTheDocument()
      expect(screen.queryByText('workflow.tabs.allTriggers')).not.toBeInTheDocument()
      expect(screen.getByText('workflow.blocks.mostCommon')).toBeInTheDocument()
      expect(screen.getByText('Provider One')).toBeInTheDocument()
      await user.click(screen.getByText('workflow.blocks.start'))
      expect(onSelect).toHaveBeenCalledWith(BlockEnum.Start)

      await user.click(screen.getByText('Provider One'))
      await user.click(screen.getByText('Created'))

      expect(onSelect).toHaveBeenCalledWith(
        BlockEnum.TriggerPlugin,
        expect.objectContaining({
          provider_id: 'provider-one',
          event_name: 'created',
        }),
      )
    })

    it('should link to the trigger marketplace when marketplace is enabled', async () => {
      enableMarketplaceForRender = true

      render(
        <AllStartBlocks
          searchText=""
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.TriggerPlugin]}
        />,
      )

      const footerLink = await screen.findByRole('link', {
        name: /plugin\.findMoreInMarketplace/,
      })
      expect(footerLink.closest('footer')).toBeInTheDocument()
      expect(footerLink).toHaveAttribute('href', 'https://marketplace.test/plugins/trigger')
    })

    it('should expose the panel marketplace destination', async () => {
      enableMarketplaceForRender = true

      render(
        <AllStartBlocks
          variant="panel"
          searchText=""
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.TriggerPlugin]}
        />,
      )

      const footerLink = await screen.findByRole('link', {
        name: /workflow\.nodes\.startPlaceholder\.browseMoreOnMarketplace/,
      })
      expect(footerLink.closest('footer')).toBeInTheDocument()
      expect(footerLink).toHaveAttribute('href', 'https://marketplace.test/plugins/trigger')
    })

    it('should render searched marketplace results after built-in and installed trigger options', async () => {
      enableMarketplaceForRender = true
      mockUseAllTriggerPlugins.mockReturnValue(
        createTriggerPluginsQueryResult([
          createTriggerProvider({
            label: { en_US: 'Start Provider', zh_Hans: 'Start Provider' },
          }),
        ]),
      )
      mockUseMarketplacePlugins.mockReturnValue(
        createMarketplacePluginsMock([
          createPlugin({
            name: 'start-marketplace',
            label: { en_US: 'Start Marketplace', zh_Hans: 'Start Marketplace' },
          }),
        ]),
      )

      const { container } = render(
        <AllStartBlocks
          searchText="start"
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.Start, BlockEnum.TriggerPlugin]}
          allowUserInputSelection
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('Start Marketplace')).toBeInTheDocument()
      })

      const text = container.textContent || ''
      expect(text.indexOf('workflow.blocks.start')).toBeLessThan(text.indexOf('Start Provider'))
      expect(text.indexOf('Start Provider')).toBeLessThan(text.indexOf('Start Marketplace'))
      expect(screen.getAllByRole('link', { name: /plugin\.searchInMarketplace/i })).toHaveLength(1)
    })

    it('should show the user input conflict state without allowing another start selection', () => {
      const onSelect = vi.fn()
      enableMarketplaceForRender = true
      mockUseNodes.mockReturnValue([
        {
          id: 'start',
          data: {
            type: BlockEnum.Start,
          },
        },
      ] as never)

      render(
        <AllStartBlocks
          searchText=""
          onSelect={onSelect}
          availableBlocksTypes={[BlockEnum.Start, BlockEnum.TriggerPlugin]}
          hasUserInputNode
        />,
      )

      expect(
        screen.getByText('workflow.nodes.startPlaceholder.userInputConflictTip'),
      ).toBeInTheDocument()
      expect(screen.queryByText('workflow.tabs.allTriggers')).not.toBeInTheDocument()
      const userInputButton = screen.getByRole('button', { name: 'workflow.blocks.start' })
      expect(userInputButton).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText('common.operation.added')).toBeInTheDocument()
      const footer = screen.getByRole('link', { name: /plugin\.findMoreInMarketplace/ })
      const disabledRegion = userInputButton.closest('[inert]')
      expect(disabledRegion).toHaveAttribute('inert')
      expect(disabledRegion).not.toContainElement(footer)

      fireEvent.click(userInputButton)
      fireEvent.click(screen.getByText('Provider One'))

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should keep user input visible but disabled when another trigger already exists', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <AllStartBlocks
          searchText=""
          onSelect={onSelect}
          availableBlocksTypes={[BlockEnum.Start, BlockEnum.TriggerSchedule]}
          hasTriggerNode
        />,
      )

      expect(screen.queryByText('workflow.tabs.allTriggers')).not.toBeInTheDocument()
      const userInputButton = screen.getByRole('button', {
        name: /workflow\.blocks\.start.*workflow\.nodes\.startPlaceholder\.userInputConflictTip/,
      })
      expect(userInputButton).toHaveAttribute('aria-disabled', 'true')

      await user.hover(userInputButton)

      expect(
        await screen.findByText('workflow.nodes.startPlaceholder.userInputConflictTip'),
      ).toBeInTheDocument()

      fireEvent.click(userInputButton)
      expect(onSelect).not.toHaveBeenCalled()

      await user.click(screen.getByText('workflow.blocks.trigger-schedule'))
      expect(onSelect).toHaveBeenCalledWith(BlockEnum.TriggerSchedule)
    })
  })

  // Empty filter states should surface the request-to-community fallback.
  describe('Filtered Empty State', () => {
    it('should show the no-results state immediately when marketplace search is unavailable', () => {
      mockUseAllTriggerPlugins.mockReturnValue(createTriggerPluginsQueryResult([]))

      render(
        <AllStartBlocks
          searchText="missing"
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.TriggerPlugin]}
        />,
      )

      expect(
        screen.getByText('workflow.nodes.startPlaceholder.noTriggersFound'),
      ).toBeInTheDocument()
      expect(mockUseMarketplacePlugins).toHaveBeenLastCalledWith(undefined)
    })

    it('should query marketplace and show the no-results state when filters have no matches', async () => {
      enableMarketplaceForRender = true
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
        expect(mockUseMarketplacePlugins).toHaveBeenCalledWith({
          query: 'missing',
          tags: ['webhook'],
          category: 'trigger',
        })
      })

      expect(
        screen.getByText('workflow.nodes.startPlaceholder.noTriggersFound'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'workflow.tabs.requestToCommunity' }),
      ).toHaveAttribute(
        'href',
        'https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml',
      )
      expect(screen.getByRole('link', { name: /plugin\.findMoreInMarketplace/ })).toHaveAttribute(
        'href',
        'https://marketplace.test/plugins/trigger',
      )
    })

    it('should debounce marketplace requests across search and tag changes', async () => {
      enableMarketplaceForRender = true
      mockUseAllTriggerPlugins.mockReturnValue(createTriggerPluginsQueryResult([]))

      const props = {
        onSelect: vi.fn(),
        availableBlocksTypes: [BlockEnum.TriggerPlugin],
      }
      const { rerender } = render(<AllStartBlocks {...props} searchText="" tags={[]} />)

      rerender(<AllStartBlocks {...props} searchText="w" tags={[]} />)
      rerender(<AllStartBlocks {...props} searchText="web" tags={['api']} />)
      rerender(<AllStartBlocks {...props} searchText="webhook" tags={['automation']} />)

      expect(
        mockUseMarketplacePlugins.mock.calls
          .map(([params]) => params)
          .filter((params) => params?.query || params?.tags?.length),
      ).toEqual([])
      expect(
        screen.queryByText('workflow.nodes.startPlaceholder.noTriggersFound'),
      ).not.toBeInTheDocument()

      await waitFor(() => {
        expect(mockUseMarketplacePlugins).toHaveBeenLastCalledWith({
          query: 'webhook',
          tags: ['automation'],
          category: PluginCategoryEnum.trigger,
        })
      })

      expect(
        mockUseMarketplacePlugins.mock.calls
          .map(([params]) => params)
          .filter((params) => params?.query || params?.tags?.length),
      ).toEqual([
        {
          query: 'webhook',
          tags: ['automation'],
          category: PluginCategoryEnum.trigger,
        },
      ])
    })
  })
})
