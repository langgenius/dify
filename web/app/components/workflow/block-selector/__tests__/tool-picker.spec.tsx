import type {
  ToolApiEntity,
  ToolProviderApiEntityResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ToolValue } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { zToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { OperationButton } from '@/app/components/app/configuration/base/operation-button'
import { ToolTrigger } from '@/app/components/plugins/plugin-detail-panel/tool-selector/components/tool-trigger'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as renderWithQuery,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import ToolPicker, { ToolPickerContent } from '../tool-picker'

let mockWorkspacePermissionKeys: string[] = ['tool.manage', 'plugin.install']
let queryClient = createConsoleQueryClient()
const renderWithConsoleQuery: typeof renderWithQuery = (ui, options) =>
  renderWithQuery(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, {
    ...options,
    queryClient,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  })
const toolListKeys = { builtin: consoleQuery.workspaces.current.tools.builtin.get.queryKey() }
const { getBuiltInTools, getCustomTools, getWorkflowTools, getMCPTools, api } = vi.hoisted(() => ({
  getBuiltInTools:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.builtin.get>(),
  getCustomTools:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.api.get>(),
  getWorkflowTools:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.workflow.get>(),
  getMCPTools:
    vi.fn<typeof import('@/service/console').consoleClient.workspaces.current.tools.mcp.get>(),
  api: {
    search: vi.fn<typeof import('@/service/marketplace').marketplaceClient.searchAdvanced>(),
    recommend:
      vi.fn<
        (
          url: string,
          options: { body: { limit: number } },
        ) => Promise<{ data: { plugins: import('@/app/components/plugins/types').Plugin[] } }>
      >(),
    createCustom:
      vi.fn<
        typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.add.post
      >(),
    parseSchema:
      vi.fn<
        typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.schema.post
      >(),
    install:
      vi.fn<
        typeof import('@/service/console').consoleClient.workspaces.current.plugin.install.marketplace.post
      >(),
  },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  const { createPluginEntity } = await import('@/test/fixtures/plugin')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': getBuiltInTools,
      'workspaces.current.tools.api.get': getCustomTools,
      'workspaces.current.tools.workflow.get': getWorkflowTools,
      'workspaces.current.tools.mcp.get': getMCPTools,
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.toolProvider.api.add.post': api.createCustom,
      'workspaces.current.toolProvider.api.schema.post': api.parseSchema,
      'workspaces.current.plugin.marketplace.pkg.get': async () => ({
        manifest: createPluginEntity().declaration,
      }),
      'workspaces.current.plugin.install.marketplace.post': api.install,
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
    }),
  }
})
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceClient: { ...actual.marketplaceClient, searchAdvanced: api.search },
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  postMarketplace: api.recommend,
}))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.test',
}))

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

const createToolProvider = (overrides: Partial<ToolProviderApiEntityResponse> = {}) =>
  zToolProviderApiEntityResponse.parse({
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
    mockWorkspacePermissionKeys = ['tool.manage', 'plugin.install']
    queryClient = createConsoleQueryClient()
    seedToolProviders(queryClient, { builtInTools, customTools, workflowTools, mcpTools })
    seedModelProviderQueries(queryClient)
    getBuiltInTools.mockReset().mockResolvedValue(builtInTools)
    getCustomTools.mockReset().mockResolvedValue(customTools)
    getWorkflowTools.mockReset().mockResolvedValue(workflowTools)
    getMCPTools.mockReset().mockResolvedValue(mcpTools)
    api.search.mockReset().mockResolvedValue({ data: { plugins: [], total: 0 } })
    api.recommend.mockReset().mockResolvedValue({ data: { plugins: [] } })
    api.createCustom.mockReset().mockResolvedValue({ result: 'success' })
    api.parseSchema.mockReset().mockResolvedValue({
      parameters_schema: [],
      credentials_schema: [],
      warning: {},
      schema_type: 'openapi',
    })
    api.install.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
  })
  afterEach(async () => {
    await act(async () => cleanup())
  })

  it('prevents opening a disabled picker', async () => {
    const user = userEvent.setup()
    const disabledOnShowChange = vi.fn()

    renderToolPicker({
      disabled: true,
      onShowChange: disabledOnShowChange,
    })

    await user.click(screen.getByRole('button', { name: 'open-picker' }))
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

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ query: 'weather', tags: [], category: 'tool' }),
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    )

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
      api.search.mockResolvedValue({
        data: { plugins: [installedPlugin, availablePlugin], total: 2 },
      })

      renderToolPicker({ isShow: true, scope, selectedTools: [] })

      expect(await screen.findByText(visibleProvider)).toBeInTheDocument()
      expect(screen.queryByText(hiddenProvider)).not.toBeInTheDocument()
      expect(screen.queryByText('Built-in Provider')).not.toBeInTheDocument()

      if (filter === 'search') {
        await user.type(screen.getByRole('searchbox', { name: 'plugin.searchTools' }), 'plugin')
      } else {
        await user.click(screen.getByRole('button', { name: 'pluginTags.allTags' }))
        await user.click(screen.getByRole('checkbox', { name: 'pluginTags.tags.weather' }))
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
      api.search.mockResolvedValue({
        data: { plugins: [newlyInstalledPlugin, availablePlugin], total: 2 },
      })
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
    getCustomTools.mockResolvedValue([
      ...customTools,
      createToolProvider({
        id: 'created-custom',
        type: CollectionType.custom,
        label: { en_US: 'New Collection' },
      }),
    ])
    renderToolPicker({
      isShow: true,
      supportAddCustomTool: true,
    })

    await user.click(screen.getByRole('button', { name: 'tools.addToolModal.custom.tip' }))
    const drawer = await screen.findByRole('dialog', { name: 'tools.createTool.title' })
    await user.type(
      within(drawer).getByRole('textbox', { name: /tools.createTool.name/ }),
      'New Collection',
    )
    const schema = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Weather', version: '1.0.0' },
      servers: [{ url: 'https://weather.example.com' }],
      paths: {},
    })
    await user.click(within(drawer).getByPlaceholderText('tools.createTool.schemaPlaceHolder'))
    await user.paste(schema)
    await waitFor(() => expect(api.parseSchema).toHaveBeenCalledWith({ body: { schema } }))
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(api.createCustom).toHaveBeenCalledWith({
        body: expect.objectContaining({
          provider: 'New Collection',
          schema,
          schema_type: 'openapi',
          credentials: { auth_type: 'none' },
        }),
      }),
    )
    expect(await screen.findByText('New Collection')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'tools.createTool.title' })).not.toBeInTheDocument()
  })

  it('allows selecting existing custom tools without tool.manage but prevents creation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mockWorkspacePermissionKeys = []

    renderToolPicker({
      isShow: true,
      supportAddCustomTool: true,
      onSelect,
    })

    await user.type(screen.getByRole('searchbox', { name: 'plugin.searchTools' }), 'weather')
    await user.click(await screen.findByText('Weather Tool'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider_name: 'custom-provider', tool_name: 'weather-tool' }),
    )
    expect(
      screen.queryByRole('button', { name: 'tools.addToolModal.custom.tip' }),
    ).not.toBeInTheDocument()
  })

  it('refreshes available tools after completing a featured plugin installation', async () => {
    const user = userEvent.setup()

    api.recommend.mockResolvedValue({
      data: {
        plugins: [
          createPlugin({
            plugin_id: 'org/featured',
            latest_package_identifier: 'org/featured:1.0.0@checksum',
          }),
        ],
      },
    })

    renderToolPicker({
      isShow: true,
      selectedTools: [],
    })

    const featuredPluginItem = await screen.findByText('Plugin One')
    await user.hover(featuredPluginItem)
    await user.click(screen.getByRole('button', { name: 'plugin.installAction' }))
    const installer = await screen.findByRole('dialog', {
      name: 'plugin.installModal.installPlugin',
    })
    const installButton = within(installer).getByRole('button', {
      name: 'plugin.installModal.install',
    })
    await waitFor(() => expect(installButton).toBeEnabled())
    await user.click(installButton)
    const installed = await screen.findByRole('dialog', {
      name: 'plugin.installModal.installedSuccessfully',
    })
    expect(api.install).toHaveBeenCalledExactlyOnceWith({
      body: { plugin_unique_identifiers: ['org/featured:1.0.0@checksum'] },
    })
    await user.click(within(installed).getByText('common.operation.close'))
    await waitFor(() => {
      for (const request of [getBuiltInTools, getCustomTools, getWorkflowTools, getMCPTools])
        expect(request).toHaveBeenCalled()
    })
    expect(
      screen.queryByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
    ).not.toBeInTheDocument()
  })
})
