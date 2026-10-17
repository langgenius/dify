import type {
  ToolApiEntity,
  ToolProviderApiEntityResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ToolValue } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { OperationButton } from '@/app/components/app/configuration/base/operation-button'
import { useTags } from '@/app/components/plugins/hooks'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { ToolTrigger } from '@/app/components/plugins/plugin-detail-panel/tool-selector/components/tool-trigger'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { consoleQuery } from '@/service/console'
import { createCustomCollection } from '@/service/tools'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithQuery,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { Theme } from '@/types/app'
import ToolPicker, { ToolPickerContent } from '../tool-picker'

const mockNotify = vi.fn()
const toolListKeys = {
  builtin: consoleQuery.workspaces.current.tools.builtin.get.queryKey(),
  custom: consoleQuery.workspaces.current.tools.api.get.queryKey(),
  workflow: consoleQuery.workspaces.current.tools.workflow.get.queryKey(),
  mcp: consoleQuery.workspaces.current.tools.mcp.get.queryKey(),
}
const mockCreateCustomCollection = vi.mocked(createCustomCollection)
const mockInstallPackageFromMarketPlace = vi.fn()
const mockCheckInstalled = vi.fn()
const mockRefreshPluginList = vi.fn()
let mockWorkspacePermissionKeys: string[] = ['tool.manage']

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)
const mockUseTags = vi.mocked(useTags)
const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)
let queryClient = createConsoleQueryClient()
const renderWithConsoleQuery: typeof renderWithQuery = (ui, options) =>
  renderWithQuery(ui, { ...options, queryClient })
const { getBuiltInTools, getCustomTools, getWorkflowTools, getMCPTools } = vi.hoisted(() => ({
  getBuiltInTools: vi.fn(),
  getCustomTools: vi.fn(),
  getWorkflowTools: vi.fn(),
  getMCPTools: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': getBuiltInTools,
      'workspaces.current.tools.api.get': getCustomTools,
      'workspaces.current.tools.workflow.get': getWorkflowTools,
      'workspaces.current.tools.mcp.get': getMCPTools,
    }),
  }
})
const mockUseFeaturedToolsRecommendations = vi.mocked(useFeaturedToolsRecommendations)

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    MARKETPLACE_URL_PREFIX: 'https://marketplace.test',
  }
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/plugins/hooks')>()
  return {
    ...actual,
    useTags: vi.fn(),
  }
})

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({ canInstallPlugin: true }),
  }),
)

vi.mock('@/service/tools', () => ({
  createCustomCollection: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: vi.fn(),
  useInstallPackageFromMarketPlace: () => ({
    mutateAsync: mockInstallPackageFromMarketPlace,
    isPending: false,
  }),
  usePluginDeclarationFromMarketPlace: () => ({
    data: undefined,
  }),
  usePluginTaskList: () => ({
    handleRefetch: vi.fn(),
  }),
  useUpdatePackageFromMarketPlace: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: Theme.light }),
}))

vi.mock('@/app/components/tools/edit-custom-collection-modal', () => ({
  default: ({
    onAdd,
    onHide,
  }: {
    onAdd: (payload: { name: string }) => Promise<void>
    onHide: () => void
  }) => (
    <div data-testid="edit-custom-tool-modal">
      <button type="button" onClick={() => onAdd({ name: 'collection-a' })}>
        submit-custom-tool
      </button>
      <button type="button" onClick={onHide}>
        hide-custom-tool
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => mockCheckInstalled(),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit', () => ({
  default: () => ({
    canInstall: true,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: mockRefreshPluginList,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/base/check-task-status', () => ({
  default: () => ({
    check: vi.fn().mockResolvedValue({ status: 'success' }),
    stop: vi.fn(),
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: () => void | Promise<void>
    onClose: () => void
  }) => (
    <div data-testid="install-from-marketplace">
      <button type="button" onClick={() => onSuccess()}>
        complete-featured-install
      </button>
      <button type="button" onClick={onClose}>
        cancel-featured-install
      </button>
    </div>
  ),
}))

vi.mock('@/utils/var', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/var')>()
  return {
    ...actual,
    getMarketplaceUrl: (path = '') => `https://marketplace.test${path}`,
  }
})

const createTool = (
  name: string,
  label: string,
  description = `${label} description`,
): ToolApiEntity => ({
  name,
  author: 'author',
  label: {
    en_US: label,
    zh_Hans: label,
  },
  description: {
    en_US: description,
    zh_Hans: description,
  },
  parameters: [],
  labels: [],
  output_schema: {},
})

const createToolProvider = (
  overrides: Partial<ToolProviderApiEntityResponse> = {},
): ToolProviderApiEntityResponse => ({
  id: 'provider-1',
  name: 'provider-one',
  author: 'Provider Author',
  description: {
    en_US: 'Provider description',
    zh_Hans: 'Provider description',
  },
  icon: 'icon',
  icon_dark: 'icon-dark',
  label: {
    en_US: 'Provider One',
    zh_Hans: 'Provider One',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'plugin-1',
  tools: [createTool('tool-a', 'Tool A')],
  plugin_unique_identifier: 'plugin-1@1.0.0',
  ...overrides,
})

const createToolValue = (overrides: Partial<ToolValue> = {}): ToolValue => ({
  provider_name: 'provider-a',
  tool_name: 'tool-a',
  tool_label: 'Tool A',
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
  tags: [{ name: 'tag-a' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const builtInTools = [
  createToolProvider({
    id: 'built-in-1',
    name: 'built-in-provider',
    label: { en_US: 'Built-in Provider', zh_Hans: 'Built-in Provider' },
    tools: [createTool('built-in-tool', 'Built-in Tool')],
  }),
]

const customTools = [
  createToolProvider({
    id: 'custom-1',
    name: 'custom-provider',
    label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
    type: CollectionType.custom,
    tools: [createTool('weather-tool', 'Weather Tool')],
  }),
]

const workflowTools = [
  createToolProvider({
    id: 'workflow-1',
    name: 'workflow-provider',
    label: { en_US: 'Workflow Provider', zh_Hans: 'Workflow Provider' },
    type: CollectionType.workflow,
    tools: [createTool('workflow-tool', 'Workflow Tool')],
  }),
]

const mcpTools = [
  createToolProvider({
    id: 'mcp-1',
    name: 'mcp-provider',
    label: { en_US: 'MCP Provider', zh_Hans: 'MCP Provider' },
    type: CollectionType.mcp,
    tools: [createTool('mcp-tool', 'MCP Tool')],
  }),
]

const renderToolPicker = (props: Partial<React.ComponentProps<typeof ToolPicker>> = {}) => {
  return renderWithConsoleQuery(
    <ToolPicker
      disabled={false}
      trigger={<button type="button">open-picker</button>}
      isShow={false}
      onShowChange={vi.fn()}
      onSelect={vi.fn()}
      onSelectMultiple={vi.fn()}
      selectedTools={[createToolValue()]}
      {...props}
    />,
    { systemFeatures: { enable_marketplace: true } },
  )
}

describe('ToolPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = ['tool.manage']

    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseTags.mockReturnValue({
      tags: [{ name: 'weather', label: 'Weather' }],
      tagsMap: { weather: { name: 'weather', label: 'Weather' } },
      getTagLabel: (name: string) => name,
    })
    mockUseMarketplacePlugins.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useMarketplacePlugins>)
    queryClient = createConsoleQueryClient()
    seedToolProviders(queryClient, { builtInTools, customTools, workflowTools, mcpTools })
    getBuiltInTools.mockResolvedValue(builtInTools)
    getCustomTools.mockResolvedValue(customTools)
    getWorkflowTools.mockResolvedValue(workflowTools)
    getMCPTools.mockResolvedValue(mcpTools)
    mockUseFeaturedToolsRecommendations.mockReturnValue({
      plugins: [],
      isLoading: false,
    } as ReturnType<typeof useFeaturedToolsRecommendations>)
    mockCreateCustomCollection.mockResolvedValue({ result: 'success' })
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockCheckInstalled.mockReturnValue({
      installedInfo: undefined,
      isLoading: false,
      error: undefined,
    })
    window.localStorage.clear()
  })

  it('should request opening when the trigger is clicked unless the picker is disabled', async () => {
    const user = userEvent.setup()
    const onShowChange = vi.fn()
    const disabledOnShowChange = vi.fn()

    renderToolPicker({ onShowChange })

    await user.click(screen.getByRole('button', { name: 'open-picker' }))
    expect(onShowChange.mock.calls[0]?.[0]).toBe(true)

    renderToolPicker({
      disabled: true,
      onShowChange: disabledOnShowChange,
    })

    await user.click(screen.getAllByRole('button', { name: 'open-picker' })[1]!)
    expect(disabledOnShowChange).not.toHaveBeenCalled()
  })

  it('opens from the production plugin-detail trigger and restores focus on close', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <ToolPicker
          disabled={false}
          trigger={<ToolTrigger open={open} />}
          isShow={open}
          onShowChange={setOpen}
          onSelect={vi.fn()}
          onSelectMultiple={vi.fn()}
        />
      )
    }

    renderWithConsoleQuery(<Harness />, { systemFeatures: { enable_marketplace: true } })

    const trigger = screen.getByRole('button', {
      name: 'plugin.detailPanel.toolSelector.placeholder',
    })
    await user.click(trigger)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens from the production agent-tools trigger and restores focus on close', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <ToolPicker
          disabled={false}
          trigger={<OperationButton operation="add" />}
          isShow={open}
          onShowChange={setOpen}
          onSelect={vi.fn()}
          onSelectMultiple={vi.fn()}
        />
      )
    }

    renderWithConsoleQuery(<Harness />, { systemFeatures: { enable_marketplace: true } })

    const trigger = screen.getByRole('button', { name: 'common.operation.add' })
    await user.click(trigger)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('should link the find-more footer to the marketplace tool category', async () => {
    renderToolPicker({
      isShow: true,
      selectedTools: [],
    })

    const footerLink = await screen.findByRole('link', { name: /plugin\.findMoreInMarketplace/i })
    expect(footerLink.closest('footer')).toBeInTheDocument()
    expect(footerLink).toHaveAttribute('href', 'https://marketplace.test/plugins/tool')
  })

  it('should render real search and tool lists, then forward tool selections', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onSelectMultiple = vi.fn()
    renderToolPicker({
      isShow: true,
      scope: 'custom',
      onSelect,
      onSelectMultiple,
      selectedTools: [],
    })

    expect(screen.queryByText('Built-in Provider')).not.toBeInTheDocument()
    expect(await screen.findByText('Custom Provider')).toBeInTheDocument()
    expect(screen.getByText('MCP Provider')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'plugin.searchTools' }), 'weather')

    await waitFor(() => {
      expect(mockUseMarketplacePlugins).toHaveBeenLastCalledWith({
        query: 'weather',
        tags: [],
        category: PluginCategoryEnum.tool,
      })
    })
    expect(
      mockUseMarketplacePlugins.mock.calls
        .map(([params]) => params)
        .filter((params) => params?.query && params.query !== 'weather'),
    ).toEqual([])

    await waitFor(() => {
      expect(screen.getByText('Weather Tool')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Weather Tool'))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_name: 'custom-provider',
        tool_name: 'weather-tool',
        tool_label: 'Weather Tool',
      }),
    )

    await user.hover(screen.getByText('Custom Provider'))
    await user.click(screen.getByText('workflow.tabs.addAll'))

    expect(onSelectMultiple).toHaveBeenCalledWith([
      expect.objectContaining({
        provider_name: 'custom-provider',
        tool_name: 'weather-tool',
        tool_label: 'Weather Tool',
      }),
    ])
  })

  it.each([
    {
      scope: 'custom',
      filter: 'search',
      visibleProvider: 'Custom Provider',
      hiddenProvider: 'Workflow Tool',
    },
    {
      scope: 'custom',
      filter: 'tag',
      visibleProvider: 'Custom Provider',
      hiddenProvider: 'Workflow Tool',
    },
    {
      scope: 'workflow',
      filter: 'search',
      visibleProvider: 'Workflow Tool',
      hiddenProvider: 'Custom Provider',
    },
    {
      scope: 'workflow',
      filter: 'tag',
      visibleProvider: 'Workflow Tool',
      hiddenProvider: 'Custom Provider',
    },
  ] as const)(
    'excludes installed marketplace plugins from $scope pickers filtered by $filter',
    async ({ scope, filter, visibleProvider, hiddenProvider }) => {
      const user = userEvent.setup()
      const installedPlugin = createPlugin({
        plugin_id: 'installed-plugin',
        label: { en_US: 'Installed Plugin' },
      })
      const availablePlugin = createPlugin({
        plugin_id: 'available-plugin',
        label: { en_US: 'Available Plugin' },
      })
      seedToolProviders(queryClient, {
        builtInTools: [
          createToolProvider({ ...builtInTools[0], plugin_id: installedPlugin.plugin_id }),
        ],
      })
      mockUseMarketplacePlugins.mockImplementation(
        (params) =>
          ({
            data: params
              ? {
                  pages: [
                    {
                      plugins: [installedPlugin, availablePlugin],
                      total: 2,
                      page: 1,
                      page_size: 40,
                    },
                  ],
                  pageParams: [1],
                }
              : undefined,
            isFetching: false,
          }) as ReturnType<typeof useMarketplacePlugins>,
      )

      renderToolPicker({ isShow: true, scope, selectedTools: [] })

      expect(await screen.findByText(visibleProvider)).toBeInTheDocument()
      expect(screen.queryByText(hiddenProvider)).not.toBeInTheDocument()
      expect(screen.queryByText('Built-in Provider')).not.toBeInTheDocument()

      if (filter === 'search') {
        await user.type(screen.getByRole('searchbox', { name: 'plugin.searchTools' }), 'plugin')
      } else {
        await user.click(screen.getByRole('button', { name: 'pluginTags.allTags' }))
        await user.click(screen.getByRole('checkbox', { name: 'Weather' }))
        await user.keyboard('{Escape}')
      }

      expect(await screen.findByText('Available Plugin')).toBeInTheDocument()
      expect(screen.queryByText('Installed Plugin')).not.toBeInTheDocument()
      expect(screen.queryByText('Built-in Provider')).not.toBeInTheDocument()
    },
  )

  it.each(['custom', 'workflow'] as const)(
    'removes newly installed marketplace plugins when %s picker data refreshes',
    async (scope) => {
      const user = userEvent.setup()
      const newlyInstalledPlugin = createPlugin({
        plugin_id: 'new-plugin',
        label: { en_US: 'New Plugin' },
      })
      const availablePlugin = createPlugin({
        plugin_id: 'available-plugin',
        label: { en_US: 'Available Plugin' },
      })
      mockUseMarketplacePlugins.mockImplementation(
        (params) =>
          ({
            data: params
              ? {
                  pages: [
                    {
                      plugins: [newlyInstalledPlugin, availablePlugin],
                      total: 2,
                      page: 1,
                      page_size: 40,
                    },
                  ],
                  pageParams: [1],
                }
              : undefined,
            isFetching: false,
          }) as ReturnType<typeof useMarketplacePlugins>,
      )
      const props = { scope, onSelect: vi.fn(), onSelectMultiple: vi.fn() }
      renderWithConsoleQuery(<ToolPickerContent {...props} />, {
        systemFeatures: { enable_marketplace: true },
      })

      await user.type(screen.getByRole('searchbox', { name: 'plugin.searchTools' }), 'plugin')
      expect(await screen.findByText('New Plugin')).toBeInTheDocument()
      expect(screen.getByText('Available Plugin')).toBeInTheDocument()

      getBuiltInTools.mockResolvedValue([
        ...builtInTools,
        createToolProvider({ id: 'new-provider', plugin_id: newlyInstalledPlugin.plugin_id }),
      ])
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: toolListKeys.builtin })
      })

      await waitFor(() => expect(screen.queryByText('New Plugin')).not.toBeInTheDocument())
      expect(screen.getByText('Available Plugin')).toBeInTheDocument()
      expect(screen.queryByText('Built-in Provider')).not.toBeInTheDocument()
    },
  )

  it('should create a custom collection from the add button and refresh custom tools', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderToolPicker({
      isShow: true,
      supportAddCustomTool: true,
    })

    await user.click(screen.getByRole('button', { name: 'tools.addToolModal.custom.tip' }))
    expect(screen.getByTestId('edit-custom-tool-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit-custom-tool' }))

    await waitFor(() => {
      expect(mockCreateCustomCollection).toHaveBeenCalledWith({ name: 'collection-a' })
    })
    expect(getCustomTools).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(toolListKeys.builtin)?.isInvalidated).toBe(false)
    expect(screen.queryByTestId('edit-custom-tool-modal')).not.toBeInTheDocument()
  })

  it('should keep custom and workflow tools usable but hide custom create action without tool.manage', () => {
    mockWorkspacePermissionKeys = []

    renderToolPicker({
      isShow: true,
      supportAddCustomTool: true,
    })

    expect(screen.getByText('Custom Provider')).toBeInTheDocument()
    expect(screen.getByText('Built-in Provider')).toBeInTheDocument()
    expect(screen.getByText('MCP Provider')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'tools.addToolModal.custom.tip' }),
    ).not.toBeInTheDocument()
  })

  it('should invalidate all tool collections after featured install succeeds', async () => {
    const user = userEvent.setup()

    mockUseFeaturedToolsRecommendations.mockReturnValue({
      plugins: [
        createPlugin({ plugin_id: 'featured-1', latest_package_identifier: 'featured-1@1.0.0' }),
      ],
      isLoading: false,
    } as ReturnType<typeof useFeaturedToolsRecommendations>)

    renderToolPicker({
      isShow: true,
      selectedTools: [],
    })

    const featuredPluginItem = await screen.findByText('Plugin One')
    await user.hover(featuredPluginItem)
    await user.click(screen.getByRole('button', { name: 'plugin.installAction' }))
    expect(await screen.findByTestId('install-from-marketplace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'complete-featured-install' }))

    await waitFor(
      () => {
        for (const request of [getBuiltInTools, getCustomTools, getWorkflowTools, getMCPTools])
          expect(request).toHaveBeenCalledTimes(1)
      },
      { timeout: 3000 },
    )
  })
})
