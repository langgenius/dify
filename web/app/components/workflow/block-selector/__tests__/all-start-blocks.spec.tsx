import type { TriggerProviderApiEntity } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocale } from '#i18n'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useGetLanguage } from '@/context/i18n'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import {
  createTriggerEventResponseFixture,
  createTriggerProviderResponseFixture,
  seedTriggerPlugins,
} from '@/test/console/trigger-plugins'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import AllStartBlocks from '../all-start-blocks'
import { createPlugin } from './factories'

vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useGetLanguage: vi.fn(),
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: vi.fn(),
}))

// Featured triggers are not under test here; keep the collection request offline.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  const stubs: Record<string, unknown> = {
    collectionPlugins: async () => ({ data: { plugins: [] } }),
  }
  const marketplaceClient = new Proxy(actual.marketplaceClient, {
    get: (target, key, receiver) =>
      typeof key === 'string' && key in stubs ? stubs[key] : Reflect.get(target, key, receiver),
  })
  return {
    ...actual,
    marketplaceClient,
    marketplaceQuery: createTanstackQueryUtils(marketplaceClient, { path: ['marketplace'] }),
  }
})

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_MARKETPLACE_URL_PREFIX: 'https://marketplace.test',
    },
  }
})

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseLocale = vi.mocked(useLocale)
const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)

type UseMarketplacePluginsReturn = ReturnType<typeof useMarketplacePlugins>

const createTriggerProvider = (overrides: Partial<TriggerProviderApiEntity> = {}) =>
  createTriggerProviderResponseFixture({
    name: 'provider-one',
    author: 'Provider Author',
    description: { en_US: 'desc', zh_Hans: '描述' },
    icon: 'icon',
    icon_dark: 'icon-dark',
    label: { en_US: 'Provider One', zh_Hans: '提供商一' },
    plugin_id: 'plugin-1',
    plugin_unique_identifier: 'plugin-1@1.0.0',
    events: [
      createTriggerEventResponseFixture({
        name: 'created',
        identity: {
          author: 'Provider Author',
          name: 'created',
          label: { en_US: 'Created', zh_Hans: '创建' },
        },
        description: { en_US: 'Created event', zh_Hans: '创建事件' },
      }),
    ],
    ...overrides,
  })

let triggerProviders: ReturnType<typeof createTriggerProviderResponseFixture>[] = []
let enableMarketplaceForRender = false
let workflowNodes: ReturnType<typeof createNode>[] = []
const render = (ui: ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: enableMarketplaceForRender },
  })
  seedTriggerPlugins(queryClient, triggerProviders)
  return renderWorkflowComponent(ui, { queryClient, initialStoreState: { nodes: workflowNodes } })
}

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

describe('AllStartBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enableMarketplaceForRender = false
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseLocale.mockReturnValue('en-US')
    mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock())
    triggerProviders = [createTriggerProvider()]
    workflowNodes = []
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
      triggerProviders = [
        createTriggerProvider({
          label: { en_US: 'Start Provider', zh_Hans: 'Start Provider' },
        }),
      ]
      mockUseMarketplacePlugins.mockReturnValue(
        createMarketplacePluginsMock([
          createPlugin({
            name: 'start-marketplace',
            plugin_id: 'plugin-2',
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

    it('shows installed triggers once and keeps other marketplace results available', async () => {
      enableMarketplaceForRender = true
      mockUseMarketplacePlugins.mockReturnValue(
        createMarketplacePluginsMock([
          createPlugin({ plugin_id: 'plugin-1', label: { en_US: 'Installed Marketplace' } }),
          createPlugin({ plugin_id: 'plugin-2', label: { en_US: 'Available Marketplace' } }),
        ]),
      )

      render(
        <AllStartBlocks
          searchText="provider"
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.TriggerPlugin]}
        />,
      )

      expect(await screen.findByText('Provider One')).toBeInTheDocument()
      expect(screen.queryByText('Installed Marketplace')).not.toBeInTheDocument()
      expect(screen.getByText('Available Marketplace')).toBeInTheDocument()
    })

    it('should show the user input conflict state without allowing another start selection', () => {
      const onSelect = vi.fn()
      enableMarketplaceForRender = true
      workflowNodes = [createNode({ id: 'start', data: { type: BlockEnum.Start } })]

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
      triggerProviders = []

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
      triggerProviders = []

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
      triggerProviders = []

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
