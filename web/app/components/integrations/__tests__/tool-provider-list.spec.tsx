import type { ComponentProps, ReactNode } from 'react'
import { zToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { getToolType } from '@/app/components/tools/utils'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { ToolType } from '../../workflow/block-selector/types'
import ProviderList from '../tool-provider-list'

let mockEnableMarketplace = false

const createDefaultCollections = () => [
  {
    id: 'builtin-1',
    name: 'google-search',
    author: 'Dify',
    description: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    icon: 'icon-google',
    label: { en_US: 'Google Search', zh_Hans: '谷歌搜索' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: ['search'],
  },
  {
    id: 'builtin-2',
    name: 'weather-tool',
    author: 'Dify',
    description: { en_US: 'Weather Tool', zh_Hans: '天气工具' },
    icon: 'icon-weather',
    label: { en_US: 'Weather Tool', zh_Hans: '天气工具' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: ['utility'],
  },
  {
    id: 'builtin-plugin',
    name: 'plugin-tool',
    author: 'Dify',
    description: { en_US: 'Plugin Tool', zh_Hans: '插件工具' },
    icon: 'icon-plugin',
    label: { en_US: 'Plugin Tool', zh_Hans: '插件工具' },
    type: 'builtin',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: [],
    plugin_id: 'org/plugin-tool',
  },
  {
    id: 'api-1',
    name: 'my-api',
    author: 'User',
    description: { en_US: 'My API tool', zh_Hans: '我的 API 工具' },
    icon: { background: '#fff', content: '🔧' },
    label: { en_US: 'My API Tool', zh_Hans: '我的 API 工具' },
    type: 'api',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: ['api', 'tools'],
  },
  {
    id: 'workflow-1',
    name: 'wf-tool',
    author: 'User',
    description: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    icon: { background: '#fff', content: '⚡' },
    label: { en_US: 'Workflow Tool', zh_Hans: '工作流工具' },
    type: 'workflow',
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: true,
    labels: ['productivity', 'utilities'],
  },
]

let mockCollectionData: ReturnType<typeof createDefaultCollections> = []
let mockIsLoadingToolProviders = false
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['tool.manage', 'mcp.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

let mockCheckedInstalledData: { plugins: { id: string; name: string }[] } | null = null
const mockInvalidateInstalledPluginList = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: ({ enabled }: { enabled: boolean }) => ({
    data: enabled ? mockCheckedInstalledData : null,
  }),
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

const { mockCanSetPermissions, mockReferenceSetting, mockSetReferenceSettings } = vi.hoisted(
  () => ({
    mockCanSetPermissions: vi.fn(() => true),
    mockReferenceSetting: vi.fn(() => ({
      permission: {
        install_permission: 'everyone',
        debug_permission: 'admins',
      },
      auto_upgrade: {
        strategy_setting: 'fix_only',
        upgrade_time_of_day: 0,
        upgrade_mode: 'all',
        exclude_plugins: [],
        include_plugins: [],
      },
    })),
    mockSetReferenceSettings: vi.fn(),
  }),
)

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanSetPluginSettings: () => ({
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
  }),
  usePluginSettingsAccess: () => ({
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
    canDeletePlugin: true,
    canUpdatePlugin: true,
  }),
  default: () => ({
    referenceSetting: mockReferenceSetting(),
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
    setReferenceSettings: mockSetReferenceSettings,
  }),
}))

vi.mock('@/app/components/header/account-setting/update-setting-dialog', () => ({
  UpdateSettingDialog: () => (
    <button type="button" aria-label="plugin.autoUpdate.autoUpdate">
      plugin.autoUpdate.autoUpdate
    </button>
  ),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({
    payload,
    className,
  }: {
    payload: { from?: string; name: string; org?: string }
    className?: string
  }) => (
    <div
      data-testid={`card-${payload.name}`}
      data-from={payload.from}
      data-org={payload.org}
      className={className}
    >
      {payload.name}
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/tool-card-skeleton', () => ({
  default: ({ variant }: { variant?: string }) => (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} data-testid="tool-card-skeleton" data-variant={variant}>
          Loading tool
        </div>
      ))}
    </>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ tags }: { tags: string[] }) => (
    <div data-testid="card-more-info">{tags.join(', ')}</div>
  ),
}))

vi.mock('@/app/components/tools/provider/custom-create-card', () => ({
  default: ({ stepByStepTourTarget }: { stepByStepTourTarget?: string }) => (
    <div data-testid="custom-create-card" data-step-by-step-tour-target={stepByStepTourTarget}>
      Create Custom Tool
    </div>
  ),
  NewCustomToolButton: () => (
    <button type="button" data-testid="toolbar-add-custom-tool">
      tools.addSwaggerAPIAsTool
    </button>
  ),
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: { name: string }; onHide: () => void }) => (
    <div data-testid="provider-detail">
      <span>{collection.name}</span>
      <button data-testid="detail-close" onClick={onHide}>
        Close
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/empty', () => ({
  default: () => <div data-testid="workflow-empty">No workflow tools</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({
    detail,
    onUpdate,
    onHide,
  }: {
    detail: unknown
    onUpdate: () => void
    onHide: () => void
  }) =>
    detail ? (
      <div data-testid="plugin-detail-panel">
        <button data-testid="plugin-update" onClick={onUpdate}>
          Update
        </button>
        <button data-testid="plugin-close" onClick={onHide}>
          Close
        </button>
      </div>
    ) : null,
}))

vi.mock('@/app/components/plugins/marketplace/empty', () => ({
  default: ({ text }: { text: string }) => <div data-testid="empty">{text}</div>,
}))

const { mockHandleScroll, mockUseMarketplace } = vi.hoisted(() => {
  const handleScroll = vi.fn()
  return {
    mockHandleScroll: handleScroll,
    mockUseMarketplace: vi.fn(() => ({
      isLoading: false,
      marketplaceCollections: [],
      marketplaceCollectionPluginsMap: {},
      plugins: [],
      handleScroll,
      page: 1,
    })),
  }
})
vi.mock('@/app/components/tools/marketplace', () => ({
  default: ({
    showMarketplacePanel,
    isMarketplaceArrowVisible,
    contentInset,
  }: {
    showMarketplacePanel: () => void
    isMarketplaceArrowVisible: boolean
    contentInset?: string
  }) => (
    <div data-testid="marketplace" data-content-inset={contentInset}>
      <button data-testid="marketplace-arrow" onClick={showMarketplacePanel}>
        {isMarketplaceArrowVisible ? 'arrow-visible' : 'arrow-hidden'}
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/marketplace/hooks', () => ({
  useMarketplace: mockUseMarketplace,
}))

vi.mock('@/app/components/tools/mcp', () => ({
  default: ({
    providers,
    searchText,
    contentInset,
    showCreateCard,
  }: {
    providers?: Array<{ id: string }>
    searchText: string
    contentInset?: string
    showCreateCard?: boolean
  }) => (
    <div
      data-testid="mcp-list"
      data-content-inset={contentInset}
      data-provider-ids={providers?.map((provider) => provider.id).join(',')}
      data-show-create-card={String(showCreateCard)}
    >
      MCP List:
      {searchText}
    </div>
  ),
}))

vi.mock('@/app/components/tools/mcp/create-card', () => ({
  NewMCPButton: ({
    handleCreate,
  }: {
    handleCreate: (provider: { id: string; name: string; type: string }) => void
  }) => (
    <button
      type="button"
      data-testid="toolbar-add-mcp"
      onClick={() => handleCreate({ id: 'new-mcp', name: 'New MCP', type: 'mcp' })}
    >
      tools.mcp.create.cardTitle
    </button>
  ),
}))

describe('getToolType', () => {
  it.each([
    ['builtin', ToolType.BuiltIn],
    ['api', ToolType.Custom],
    ['workflow', ToolType.Workflow],
    ['mcp', ToolType.MCP],
    ['unknown', ToolType.BuiltIn],
  ] as const)('returns correct ToolType for "%s"', (input, expected) => {
    expect(getToolType(input)).toBe(expected)
  })
})

const renderProviderList = (
  searchParams?: Record<string, string>,
  category?: ComponentProps<typeof ProviderList>['category'],
  contentInset?: ComponentProps<typeof ProviderList>['contentInset'],
) => {
  const queryClient = createConsoleQueryClient()
  if (!mockIsLoadingToolProviders) {
    const providers = mockCollectionData.map((item) => zToolProviderApiEntityResponse.parse(item))
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProviders.get.queryKey({ input: { query: {} } }),
      providers,
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProviders.get.queryKey({
        input: { query: { type: 'mcp' } },
      }),
      providers.filter((item) => item.type === 'mcp'),
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.tools.api.get.queryKey(),
      providers.filter((item) => item.type === 'api'),
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.tools.workflow.get.queryKey(),
      providers.filter((item) => item.type === 'workflow'),
    )
  }
  const { wrapper: ConsoleQueryWrapper } = createConsoleQueryWrapper({
    queryClient,
    systemFeatures: { enable_marketplace: mockEnableMarketplace },
  })
  const Wrapped = ({ children }: { children: ReactNode }) => (
    <ConsoleQueryWrapper>{children}</ConsoleQueryWrapper>
  )
  return renderWithNuqs(
    <Wrapped>
      <ProviderList category={category} contentInset={contentInset} />
    </Wrapped>,
    { searchParams },
  )
}

describe('ProviderList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableMarketplace = false
    mockCollectionData = createDefaultCollections()
    mockIsLoadingToolProviders = false
    mockConsoleState.workspacePermissionKeys = ['tool.manage', 'mcp.manage']
    mockCheckedInstalledData = null
    mockCanSetPermissions.mockReturnValue(true)
    mockReferenceSetting.mockReturnValue({
      permission: {
        install_permission: 'everyone',
        debug_permission: 'admins',
      },
      auto_upgrade: {
        strategy_setting: 'fix_only',
        upgrade_time_of_day: 0,
        upgrade_mode: 'all',
        exclude_plugins: [],
        include_plugins: [],
      },
    })
    vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Tab Navigation', () => {
    it('keeps custom and workflow tabs visible without tool.manage', () => {
      mockConsoleState.workspacePermissionKeys = ['mcp.manage']

      renderProviderList()

      expect(screen.getByText('tools.type.builtIn')).toBeInTheDocument()
      expect(screen.getByText('tools.type.custom')).toBeInTheDocument()
      expect(screen.getByText('tools.type.workflow')).toBeInTheDocument()
      expect(screen.getByText('MCP')).toBeInTheDocument()
    })

    it('keeps MCP tab visible without mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = ['tool.manage']

      renderProviderList()

      expect(screen.getByText('tools.type.builtIn')).toBeInTheDocument()
      expect(screen.getByText('tools.type.custom')).toBeInTheDocument()
      expect(screen.getByText('tools.type.workflow')).toBeInTheDocument()
      expect(screen.getByText('MCP')).toBeInTheDocument()
    })

    it.each([
      ['api', 'card-my-api'],
      ['workflow', 'card-wf-tool'],
    ] as const)('renders %s category read-only without tool.manage', (category, cardTestId) => {
      mockConsoleState.workspacePermissionKeys = []

      renderProviderList({ category })

      expect(screen.getByTestId(cardTestId)).toBeInTheDocument()
      expect(screen.queryByTestId('custom-create-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-add-custom-tool')).not.toBeInTheDocument()
    })

    it('hides category tabs when controlled by route category', () => {
      renderProviderList(undefined, 'builtin')

      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.queryByText('tools.type.builtIn')).not.toBeInTheDocument()
      expect(screen.queryByText('tools.type.custom')).not.toBeInTheDocument()
      expect(screen.queryByText('tools.type.workflow')).not.toBeInTheDocument()
      expect(screen.queryByText('MCP')).not.toBeInTheDocument()
    })

    it('resets current provider when switching to a different tab', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByText('tools.type.custom'))
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })

    it('does not reset provider when clicking the already active tab', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByText('tools.type.builtIn'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
    })
  })

  describe('Filtering', () => {
    it('shows only builtin collections by default', () => {
      renderProviderList()
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
      expect(screen.queryByTestId('card-my-api')).not.toBeInTheDocument()
    })

    it('filters by search keyword', () => {
      renderProviderList()
      const input = screen.getByRole('searchbox')
      fireEvent.change(input, { target: { value: 'nonexistent' } })
      expect(screen.queryByTestId('card-google-search')).not.toBeInTheDocument()
      expect(screen.queryByTestId('empty')).not.toBeInTheDocument()
    })

    it('filters by search keyword matching label', () => {
      renderProviderList()
      const input = screen.getByRole('searchbox')
      fireEvent.change(input, { target: { value: 'Google' } })
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
    })

    it('filters search within the current route category', () => {
      renderProviderList(undefined, 'builtin')
      const input = screen.getByRole('searchbox')
      fireEvent.change(input, { target: { value: 'My API' } })
      expect(screen.queryByTestId('card-my-api')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-google-search')).not.toBeInTheDocument()
    })

    it('restores all collections when tag filter is cleared', async () => {
      const user = userEvent.setup()
      renderProviderList()
      await user.click(screen.getByRole('button', { name: 'common.tag.tags' }))
      await user.click(await screen.findByRole('button', { name: 'pluginTags.tags.search' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
    })

    it('does not apply hidden tag filters on non-tools tabs', async () => {
      const user = userEvent.setup()
      renderProviderList()

      await user.click(screen.getByRole('button', { name: 'common.tag.tags' }))
      await user.click(await screen.findByRole('button', { name: 'pluginTags.tags.search' }))
      await user.keyboard('{Escape}')
      fireEvent.click(screen.getByText('tools.type.custom'))

      expect(screen.queryByRole('button', { name: 'common.tag.tags' })).not.toBeInTheDocument()
      expect(screen.getByTestId('card-my-api')).toBeInTheDocument()
    })

    it('clears search with clear button', () => {
      renderProviderList()
      const input = screen.getByRole('searchbox')
      fireEvent.change(input, { target: { value: 'Google' } })
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
    })

    it.each([['api'], ['workflow'], ['mcp']] as const)(
      'hides label filter for the %s tool page',
      (category) => {
        renderProviderList({ category })
        expect(screen.queryByRole('button', { name: 'common.tag.tags' })).not.toBeInTheDocument()
      },
    )

    it('shows the plugin update settings action in the tools toolbar', () => {
      renderProviderList(undefined, 'builtin')

      expect(
        screen.getByRole('button', { name: 'plugin.autoUpdate.autoUpdate' }),
      ).toBeInTheDocument()
    })

    it('hides the tools update settings action when permission management is unavailable', () => {
      mockCanSetPermissions.mockReturnValue(false)

      renderProviderList(undefined, 'builtin')

      expect(
        screen.queryByRole('button', { name: 'plugin.autoUpdate.autoUpdate' }),
      ).not.toBeInTheDocument()
    })

    it.each([['mcp'], ['api'], ['workflow']] as const)(
      'hides plugin update settings on the %s tool page',
      (category) => {
        renderProviderList({ category })

        expect(
          screen.queryByRole('button', { name: 'plugin.autoUpdate.autoUpdate' }),
        ).not.toBeInTheDocument()
      },
    )
  })

  describe('Custom Tab', () => {
    it('keeps custom creation in the empty card when there are no API tools', () => {
      mockCollectionData = createDefaultCollections().filter((c) => c.type !== 'api')
      renderProviderList({ category: 'api' })

      const customCreateCard = screen.getByTestId('custom-create-card')
      expect(customCreateCard).toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-add-custom-tool')).not.toBeInTheDocument()
      const selector = getStepByStepTourTargetSelector(
        STEP_BY_STEP_TOUR_TARGETS.integrationSwaggerToolGrid,
      )
      expect(document.querySelector(selector)).toBe(customCreateCard)
    })

    it('moves custom creation into the toolbar when API tools exist', () => {
      renderProviderList({ category: 'api' })

      expect(screen.getByTestId('toolbar-add-custom-tool')).toBeInTheDocument()
      expect(screen.queryByTestId('custom-create-card')).not.toBeInTheDocument()
    })

    it('anchors the Swagger API tour target to the first custom tool card', () => {
      renderProviderList(undefined, 'api', 'compact')

      const selector = getStepByStepTourTargetSelector(
        STEP_BY_STEP_TOUR_TARGETS.integrationSwaggerToolGrid,
      )
      const target = document.querySelector(selector)

      expect(target).toBe(screen.getByTestId('card-my-api').parentElement)
      expect(target).not.toBe(screen.getByTestId('tool-provider-grid'))
    })

    it('shows custom API card author and label tags from collection labels', () => {
      renderProviderList(undefined, 'api', 'compact')

      const card = within(screen.getByTestId('card-my-api'))
      expect(card.getByText('tools.author User')).toBeInTheDocument()
      expect(card.getByText('api')).toBeInTheDocument()
      expect(card.getByText('tools')).toBeInTheDocument()
      expect(card.queryByText(/tools\.mcp\.toolsCount/)).not.toBeInTheDocument()
    })

    it('shows card skeletons instead of custom create card while tool providers are loading', () => {
      mockIsLoadingToolProviders = true
      renderProviderList({ category: 'api' })
      expect(screen.getAllByTestId('tool-card-skeleton')).toHaveLength(6)
      expect(screen.queryByTestId('custom-create-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-add-custom-tool')).not.toBeInTheDocument()
    })
  })

  describe('Workflow Tab', () => {
    it('anchors the Workflow as Tool tour target to the first workflow card', () => {
      renderProviderList(undefined, 'workflow', 'compact')

      const selector = getStepByStepTourTargetSelector(
        STEP_BY_STEP_TOUR_TARGETS.integrationWorkflowToolGrid,
      )
      const target = document.querySelector(selector)

      expect(target).toBe(screen.getByTestId('card-wf-tool').parentElement)
      expect(target).not.toBe(screen.getByTestId('tool-provider-grid'))
    })

    it('does not show the built-in badge on workflow cards', () => {
      renderProviderList(undefined, 'workflow', 'compact')

      expect(
        within(screen.getByTestId('card-wf-tool')).queryByText(
          'dataset.metadata.datasetMetadata.builtIn',
        ),
      ).not.toBeInTheDocument()
    })

    it('shows workflow card author and label tags from collection labels', () => {
      renderProviderList(undefined, 'workflow', 'compact')

      const card = within(screen.getByTestId('card-wf-tool'))
      expect(card.getByText('tools.author User')).toBeInTheDocument()
      expect(card.getByText('productivity')).toBeInTheDocument()
      expect(card.getByText('utilities')).toBeInTheDocument()
      expect(card.queryByText(/tools\.mcp\.toolsCount/)).not.toBeInTheDocument()
    })

    it('anchors the Workflow as Tool tour target to the bounded empty state when no workflow collections exist', () => {
      mockCollectionData = createDefaultCollections().filter((c) => c.type !== 'workflow')
      renderProviderList(undefined, 'workflow', 'compact')

      const selector = getStepByStepTourTargetSelector(
        STEP_BY_STEP_TOUR_TARGETS.integrationWorkflowToolGrid,
      )
      const target = document.querySelector<HTMLElement>(selector)

      expect(target).not.toBe(screen.getByTestId('tool-provider-grid'))
      expect(target).toContainElement(screen.getByTestId('workflow-empty'))
    })

    it('does not show workflow empty state when search has no matches', () => {
      renderProviderList({ category: 'workflow' })
      const input = screen.getByRole('searchbox')

      fireEvent.change(input, { target: { value: 'nonexistent' } })

      expect(screen.queryByTestId('card-wf-tool')).not.toBeInTheDocument()
      expect(screen.queryByTestId('workflow-empty')).not.toBeInTheDocument()
    })

    it('shows card skeletons instead of empty state while tool providers are loading', () => {
      mockIsLoadingToolProviders = true
      mockCollectionData = []
      renderProviderList({ category: 'workflow' })
      expect(screen.getAllByTestId('tool-card-skeleton')).toHaveLength(6)
      expect(screen.queryByTestId('workflow-empty')).not.toBeInTheDocument()
    })
  })

  describe('Builtin Tab Empty State', () => {
    it('shows empty component when no builtin collections', () => {
      mockCollectionData = createDefaultCollections().filter((c) => c.type !== 'builtin')
      renderProviderList()
      expect(screen.getByTestId('empty')).toBeInTheDocument()
    })

    it('shows card skeletons instead of empty component while tool providers are loading', () => {
      mockIsLoadingToolProviders = true
      mockCollectionData = []
      renderProviderList()
      expect(screen.getAllByTestId('tool-card-skeleton')).toHaveLength(6)
      expect(screen.queryByTestId('empty')).not.toBeInTheDocument()
    })

    it('renders collection that has no labels property', () => {
      mockCollectionData = [
        {
          id: 'no-labels',
          name: 'no-label-tool',
          author: 'Dify',
          description: { en_US: 'Tool', zh_Hans: '工具' },
          icon: 'icon',
          label: { en_US: 'No Label Tool', zh_Hans: '无标签工具' },
          type: 'builtin',
          team_credentials: {},
          is_team_authorization: false,
          allow_delete: false,
        },
      ] as unknown as ReturnType<typeof createDefaultCollections>
      renderProviderList()
      expect(screen.getByTestId('card-no-label-tool')).toBeInTheDocument()
    })

    it('maps plugin collection identity to the shared card payload', () => {
      renderProviderList()

      expect(screen.getByTestId('card-plugin-tool')).toHaveAttribute('data-org', 'org')
      expect(screen.getByTestId('card-plugin-tool')).toHaveAttribute('data-from', 'marketplace')
    })

    it('keeps non-plugin collections out of the marketplace icon path', () => {
      renderProviderList()

      expect(screen.getByTestId('card-google-search')).toHaveAttribute('data-from', 'package')
    })

    it('shows only the built-in source label on integrations tool cards', () => {
      renderProviderList(undefined, 'builtin', 'compact')

      expect(
        within(screen.getByTestId('card-google-search')).getByText(
          'dataset.metadata.datasetMetadata.builtIn',
        ),
      ).toBeInTheDocument()
      expect(
        within(screen.getByTestId('card-google-search')).queryByText('plugin.from'),
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByTestId('card-plugin-tool')).queryByText('plugin.from'),
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByTestId('card-plugin-tool')).queryByText('plugin.source.marketplace'),
      ).not.toBeInTheDocument()
    })

    it('falls back to the collection name when plugin_id has no package segment', () => {
      mockCollectionData = [
        {
          id: 'builtin-plugin-with-short-id',
          name: 'fallback-plugin-name',
          author: 'Dify',
          description: { en_US: 'Plugin Tool', zh_Hans: '插件工具' },
          icon: 'icon-plugin',
          label: { en_US: 'Plugin Tool', zh_Hans: '插件工具' },
          type: 'builtin',
          team_credentials: {},
          is_team_authorization: false,
          allow_delete: false,
          labels: [],
          plugin_id: 'openai',
        },
      ]

      renderProviderList()

      expect(screen.getByTestId('card-fallback-plugin-name')).toHaveAttribute('data-org', '')
    })
  })

  describe('MCP Tab', () => {
    it('uses database provider IDs from the management list', () => {
      const provider = {
        id: '019d3f85-d61c-765e-9615-8f469d02689f',
        name: 'mcp-server',
        author: 'User',
        description: { en_US: 'MCP Server', zh_Hans: 'MCP 服务' },
        icon: { background: '#fff', content: 'M' },
        label: { en_US: 'MCP Server', zh_Hans: 'MCP 服务' },
        type: 'mcp' as const,
        team_credentials: {},
        is_team_authorization: false,
        allow_delete: true,
        labels: [],
      }
      mockCollectionData = [...createDefaultCollections(), provider]

      renderProviderList({ category: 'mcp' })

      expect(screen.getByTestId('mcp-list')).toHaveAttribute(
        'data-provider-ids',
        '019d3f85-d61c-765e-9615-8f469d02689f',
      )
    })

    it('renders MCP list read-only without mcp.manage', () => {
      mockConsoleState.workspacePermissionKeys = ['tool.manage']

      renderProviderList({ category: 'mcp' })

      expect(screen.getByTestId('mcp-list')).toBeInTheDocument()
      expect(screen.getByTestId('mcp-list')).toHaveAttribute('data-show-create-card', 'false')
      expect(screen.queryByTestId('toolbar-add-mcp')).not.toBeInTheDocument()
    })

    it('keeps MCP creation in the empty card when there are no MCP servers', () => {
      renderProviderList({ category: 'mcp' })

      expect(screen.queryByTestId('toolbar-add-mcp')).not.toBeInTheDocument()
      expect(screen.getByTestId('mcp-list')).toHaveAttribute('data-show-create-card', 'true')
    })

    it('moves MCP creation into the toolbar when MCP servers exist', () => {
      mockCollectionData = [
        ...createDefaultCollections(),
        {
          id: 'mcp-1',
          name: 'mcp-server',
          author: 'User',
          description: { en_US: 'MCP Server', zh_Hans: 'MCP 服务' },
          icon: { background: '#fff', content: 'M' },
          label: { en_US: 'MCP Server', zh_Hans: 'MCP 服务' },
          type: 'mcp',
          team_credentials: {},
          is_team_authorization: false,
          allow_delete: true,
          labels: [],
        },
      ]

      renderProviderList({ category: 'mcp' })

      expect(screen.getByTestId('toolbar-add-mcp')).toBeInTheDocument()
      expect(screen.getByTestId('mcp-list')).toHaveAttribute('data-show-create-card', 'false')
    })
  })

  describe('Provider Detail', () => {
    it('closes provider detail when close button is clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toHaveTextContent('google-search')
      fireEvent.click(screen.getByTestId('detail-close'))
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })
  })

  describe('Plugin Detail Panel', () => {
    it('calls invalidateInstalledPluginList on plugin update', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      fireEvent.click(screen.getByTestId('plugin-update'))
      expect(mockInvalidateInstalledPluginList).toHaveBeenCalledExactlyOnceWith('tool')
    })

    it('clears current provider on plugin panel close', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      expect(screen.getByTestId('plugin-detail-panel')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('plugin-close'))
      expect(screen.queryByTestId('plugin-detail-panel')).not.toBeInTheDocument()
    })
  })

  describe('Marketplace', () => {
    it('shows marketplace when enable_marketplace is true and on builtin tab', () => {
      mockEnableMarketplace = true
      renderProviderList()
      expect(screen.getByTestId('marketplace')).toBeInTheDocument()
    })

    it('does not show marketplace when enable_marketplace is false', () => {
      renderProviderList()
      expect(screen.queryByTestId('marketplace')).not.toBeInTheDocument()
    })

    it('does not initialize marketplace hook outside builtin tools', () => {
      mockEnableMarketplace = true
      renderProviderList(undefined, 'workflow')
      expect(screen.queryByTestId('marketplace')).not.toBeInTheDocument()
      expect(mockUseMarketplace).not.toHaveBeenCalled()
    })

    it('scrolls to marketplace panel on arrow click', () => {
      mockEnableMarketplace = true
      renderProviderList()
      fireEvent.click(screen.getByTestId('marketplace-arrow'))
      expect(Element.prototype.scrollTo).toHaveBeenCalled()
    })
  })

  describe('Scroll Handling', () => {
    it('delegates scroll events to marketplace handleScroll', () => {
      mockEnableMarketplace = true
      renderProviderList()
      const scrollContainer = screen.getByRole('region', {
        name: 'navigation.menus.tools',
      }) as HTMLDivElement
      fireEvent.scroll(scrollContainer)
      expect(mockHandleScroll).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ type: 'scroll', target: scrollContainer }),
      )
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProviders.get': async () =>
        mockCollectionData.map((item) => zToolProviderApiEntityResponse.parse(item)),
      'workspaces.current.tools.api.get': async () =>
        mockCollectionData
          .filter((item) => item.type === 'api')
          .map((item) => zToolProviderApiEntityResponse.parse(item)),
      'workspaces.current.tools.workflow.get': async () =>
        mockCollectionData
          .filter((item) => item.type === 'workflow')
          .map((item) => zToolProviderApiEntityResponse.parse(item)),
    }),
  }
})
