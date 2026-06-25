import type { ComponentProps, ReactNode } from 'react'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { getToolType } from '@/app/components/tools/utils'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { ToolTypeEnum } from '../../workflow/block-selector/types'
import ProviderList from '../tool-provider-list'

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [],
    tagsMap: {},
    getTagLabel: (name: string) => name,
  }),
}))

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
const mockRefetch = vi.fn()
const mockUseAllToolProviders = vi.hoisted(() => vi.fn())
vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: (enabled?: boolean) => mockUseAllToolProviders(enabled),
}))

const mockAppContextState = vi.hoisted(() => ({
  workspacePermissionKeys: ['tool.manage', 'mcp.manage'] as string[],
}))
vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (state: { workspacePermissionKeys: string[] }) => T): T => selector({
    workspacePermissionKeys: mockAppContextState.workspacePermissionKeys,
  }),
}))

let mockCheckedInstalledData: { plugins: { id: string, name: string }[] } | null = null
const mockInvalidateInstalledPluginList = vi.fn()
vi.mock('@/service/use-plugins', () => ({
  useCheckInstalled: ({ enabled }: { enabled: boolean }) => ({
    data: enabled ? mockCheckedInstalledData : null,
  }),
  useInvalidateInstalledPluginList: () => mockInvalidateInstalledPluginList,
}))

const {
  mockCanSetPermissions,
  mockReferenceSetting,
  mockSetReferenceSettings,
} = vi.hoisted(() => ({
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
}))

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
    canViewInstalledPlugins: true,
  }),
  default: () => ({
    referenceSetting: mockReferenceSetting(),
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
    setReferenceSettings: mockSetReferenceSettings,
  }),
}))

vi.mock('@/app/components/header/account-setting/update-setting-dialog', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="update-setting-dialog">
      <button type="button">
        plugin.autoUpdate.autoUpdate
        <span>plugin.autoUpdate.strategy.fixOnly.name</span>
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card', () => ({
  default: ({ payload, className }: { payload: { from?: string, name: string, org?: string }, className?: string }) => (
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
        <div key={index} data-testid="tool-card-skeleton" data-variant={variant}>Loading tool</div>
      ))}
    </>
  ),
}))

vi.mock('@/app/components/plugins/card/card-more-info', () => ({
  default: ({ tags }: { tags: string[] }) => <div data-testid="card-more-info">{tags.join(', ')}</div>,
}))

vi.mock('@/app/components/tools/labels/filter', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (v: string[]) => void }) => (
    <div data-testid="label-filter">
      <button data-testid="add-filter" onClick={() => onChange(['search'])}>Add filter</button>
      <button data-testid="clear-filter" onClick={() => onChange([])}>Clear filter</button>
      <span>{value.join(', ')}</span>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/custom-create-card', () => ({
  default: () => <div data-testid="custom-create-card">Create Custom Tool</div>,
  NewCustomToolButton: () => <button type="button" data-testid="toolbar-add-custom-tool">tools.addSwaggerAPIAsTool</button>,
}))

vi.mock('@/app/components/tools/provider/detail', () => ({
  default: ({ collection, onHide }: { collection: { name: string }, onHide: () => void }) => (
    <div data-testid="provider-detail">
      <span>{collection.name}</span>
      <button data-testid="detail-close" onClick={onHide}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/tools/provider/empty', () => ({
  default: () => <div data-testid="workflow-empty">No workflow tools</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel', () => ({
  default: ({ detail, onUpdate, onHide }: { detail: unknown, onUpdate: () => void, onHide: () => void }) =>
    detail
      ? (
          <div data-testid="plugin-detail-panel">
            <button data-testid="plugin-update" onClick={onUpdate}>Update</button>
            <button data-testid="plugin-close" onClick={onHide}>Close</button>
          </div>
        )
      : null,
}))

vi.mock('@/app/components/plugins/marketplace/empty', () => ({
  default: ({ text }: { text: string }) => <div data-testid="empty">{text}</div>,
}))

const {
  mockHandleScroll,
  mockUseMarketplace,
} = vi.hoisted(() => {
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
  default: ({ showMarketplacePanel, isMarketplaceArrowVisible, contentInset }: {
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
  default: ({ searchText, contentInset, showCreateCard }: { searchText: string, contentInset?: string, showCreateCard?: boolean }) => (
    <div data-testid="mcp-list" data-content-inset={contentInset} data-show-create-card={String(showCreateCard)}>
      MCP List:
      {searchText}
    </div>
  ),
}))

vi.mock('@/app/components/tools/mcp/create-card', () => ({
  NewMCPButton: ({ handleCreate }: { handleCreate: (provider: { id: string, name: string, type: string }) => void }) => (
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
    ['builtin', ToolTypeEnum.BuiltIn],
    ['api', ToolTypeEnum.Custom],
    ['workflow', ToolTypeEnum.Workflow],
    ['mcp', ToolTypeEnum.MCP],
    ['unknown', ToolTypeEnum.BuiltIn],
  ])('returns correct ToolTypeEnum for "%s"', (input, expected) => {
    expect(getToolType(input)).toBe(expected)
  })
})

const renderProviderList = (
  searchParams?: Record<string, string>,
  category?: ComponentProps<typeof ProviderList>['category'],
  contentInset?: ComponentProps<typeof ProviderList>['contentInset'],
) => {
  const { wrapper: SystemFeaturesWrapper } = createSystemFeaturesWrapper({
    systemFeatures: { enable_marketplace: mockEnableMarketplace },
  })
  const Wrapped = ({ children }: { children: ReactNode }) => (
    <SystemFeaturesWrapper>{children}</SystemFeaturesWrapper>
  )
  return renderWithNuqs(
    <Wrapped><ProviderList category={category} contentInset={contentInset} /></Wrapped>,
    { searchParams },
  )
}

describe('ProviderList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableMarketplace = false
    mockCollectionData = createDefaultCollections()
    mockIsLoadingToolProviders = false
    mockAppContextState.workspacePermissionKeys = ['tool.manage', 'mcp.manage']
    mockUseAllToolProviders.mockImplementation((enabled = true) => ({
      data: enabled ? mockCollectionData : [],
      isLoading: enabled ? mockIsLoadingToolProviders : false,
      refetch: mockRefetch,
    }))
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
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Tab Navigation', () => {
    it('renders all four tabs', () => {
      renderProviderList()
      expect(screen.getByText('tools.type.builtIn')).toBeInTheDocument()
      expect(screen.getByText('tools.type.custom')).toBeInTheDocument()
      expect(screen.getByText('tools.type.workflow')).toBeInTheDocument()
      expect(screen.getByText('MCP')).toBeInTheDocument()
    })

    it('keeps custom and workflow tabs visible without tool.manage', () => {
      mockAppContextState.workspacePermissionKeys = ['mcp.manage']

      renderProviderList()

      expect(screen.getByText('tools.type.builtIn')).toBeInTheDocument()
      expect(screen.getByText('tools.type.custom')).toBeInTheDocument()
      expect(screen.getByText('tools.type.workflow')).toBeInTheDocument()
      expect(screen.getByText('MCP')).toBeInTheDocument()
    })

    it('keeps MCP tab visible without mcp.manage', () => {
      mockAppContextState.workspacePermissionKeys = ['tool.manage']

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
      mockAppContextState.workspacePermissionKeys = []

      renderProviderList({ category })

      expect(mockUseAllToolProviders).toHaveBeenCalledWith(undefined)
      expect(screen.getByTestId(cardTestId)).toBeInTheDocument()
      expect(screen.queryByTestId('custom-create-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-add-custom-tool')).not.toBeInTheDocument()
    })

    it('switches tab when clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByText('tools.type.custom'))
      expect(screen.getByTestId('toolbar-add-custom-tool')).toBeInTheDocument()
      expect(screen.queryByTestId('custom-create-card')).not.toBeInTheDocument()
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

  describe('Layout', () => {
    it('uses default content inset outside compact integrations layout', () => {
      renderProviderList()
      const toolbar = screen.getByRole('searchbox').closest('.bg-components-panel-bg')

      expect(screen.getByRole('region', { name: 'common.menus.tools' })).toBeInTheDocument()
      expect(toolbar).toHaveClass('px-12', 'pt-2', 'pb-0', 'bg-components-panel-bg')
      expect(toolbar).toHaveClass('max-w-[1600px]')
      expect(toolbar).not.toHaveClass('sticky')
      expect(screen.getByTestId('card-google-search').closest('.grid')).toHaveClass('px-12', 'gap-2', 'pt-2')
      expect(screen.getByTestId('card-google-search').closest('.grid')).toHaveClass('max-w-[1600px]')
    })

    it('uses compact content inset when rendered by integrations layout', () => {
      renderProviderList(undefined, 'builtin', 'compact')
      const toolbar = screen.getByRole('searchbox').closest('.bg-components-panel-bg')

      expect(screen.getByRole('region', { name: 'common.menus.tools' })).toBeInTheDocument()
      expect(toolbar).toHaveClass('px-6', 'pt-2', 'pb-0', 'bg-components-panel-bg')
      expect(toolbar).toHaveClass('max-w-[1600px]')
      expect(toolbar).not.toHaveClass('sticky')
      expect(screen.getByTestId('tool-provider-grid')).toHaveClass('px-6', 'gap-2', 'pt-1')
      expect(screen.getByTestId('tool-provider-grid')).toHaveClass('max-w-[1600px]')
    })

    it('uses a two-column grid in compact integrations pages', () => {
      renderProviderList(undefined, 'builtin', 'compact')

      expect(screen.getByTestId('tool-provider-grid')).toHaveClass('grid', 'grid-cols-1', 'lg:grid-cols-2')
      expect(screen.getByTestId('tool-provider-grid')).not.toHaveClass('flex', 'flex-wrap', 'md:grid-cols-3')
      expect(screen.getByTestId('card-google-search').parentElement).toHaveClass('min-w-0')
      expect(screen.getByTestId('card-google-search').parentElement).not.toHaveClass('flex-1')
    })

    it('keeps the default plugin card border visible until a card is selected', () => {
      renderProviderList(undefined, 'builtin', 'compact')

      expect(screen.getByTestId('card-google-search')).toHaveClass('cursor-pointer')
      expect(screen.getByTestId('card-google-search')).not.toHaveClass('border-transparent')
      expect(screen.getByTestId('card-google-search')).not.toHaveClass('border-[1.5px]')

      fireEvent.click(screen.getByTestId('card-google-search'))

      expect(screen.getByTestId('card-google-search')).toHaveClass('outline-[1.5px]', 'outline-components-option-card-option-selected-border')
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

    it('filters collections by tag', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('add-filter'))
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-plugin-tool')).not.toBeInTheDocument()
    })

    it('restores all collections when tag filter is cleared', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('add-filter'))
      expect(screen.queryByTestId('card-weather-tool')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('clear-filter'))
      expect(screen.getByTestId('card-google-search')).toBeInTheDocument()
      expect(screen.getByTestId('card-weather-tool')).toBeInTheDocument()
    })

    it('does not apply hidden tag filters on non-tools tabs', () => {
      renderProviderList()

      fireEvent.click(screen.getByTestId('add-filter'))
      fireEvent.click(screen.getByText('tools.type.custom'))

      expect(screen.queryByTestId('label-filter')).not.toBeInTheDocument()
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

    it('shows label filter for the built-in tools page', () => {
      renderProviderList()
      expect(screen.getByTestId('label-filter')).toBeInTheDocument()
    })

    it.each([
      ['api'],
      ['workflow'],
      ['mcp'],
    ] as const)('hides label filter for the %s tool page', (category) => {
      renderProviderList({ category })
      expect(screen.queryByTestId('label-filter')).not.toBeInTheDocument()
    })

    it('renders search input', () => {
      renderProviderList()
      expect(screen.getByRole('searchbox')).toBeInTheDocument()
    })

    it('uses the plugin update settings dialog from the tools toolbar', () => {
      renderProviderList(undefined, 'builtin')

      expect(screen.getByText('plugin.autoUpdate.autoUpdate')).toBeInTheDocument()
      expect(screen.getByText('plugin.autoUpdate.strategy.fixOnly.name')).toBeInTheDocument()
      expect(screen.getByTestId('update-setting-dialog')).toBeInTheDocument()
    })

    it('hides the tools update settings action when permission management is unavailable', () => {
      mockCanSetPermissions.mockReturnValue(false)

      renderProviderList(undefined, 'builtin')

      expect(screen.queryByTestId('update-setting-dialog')).not.toBeInTheDocument()
    })

    it.each([
      ['mcp'],
      ['api'],
      ['workflow'],
    ] as const)('hides plugin update settings on the %s tool page', (category) => {
      renderProviderList({ category })

      expect(screen.queryByText('plugin.autoUpdate.autoUpdate')).not.toBeInTheDocument()
      expect(screen.queryByText('plugin.autoUpdate.strategy.fixOnly.name')).not.toBeInTheDocument()
    })
  })

  describe('Custom Tab', () => {
    it('keeps custom creation in the empty card when there are no API tools', () => {
      mockCollectionData = createDefaultCollections().filter(c => c.type !== 'api')
      renderProviderList({ category: 'api' })

      expect(screen.getByTestId('custom-create-card')).toBeInTheDocument()
      expect(screen.queryByTestId('toolbar-add-custom-tool')).not.toBeInTheDocument()
    })

    it('moves custom creation into the toolbar when API tools exist', () => {
      renderProviderList({ category: 'api' })

      expect(screen.getByTestId('toolbar-add-custom-tool')).toBeInTheDocument()
      expect(screen.queryByTestId('custom-create-card')).not.toBeInTheDocument()
    })

    it('uses responsive grid columns for custom tool cards', () => {
      renderProviderList({ category: 'api' })

      expect(screen.getByTestId('tool-provider-grid')).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3', 'gap-2.5', 'pt-1')
      expect(screen.getByTestId('tool-provider-grid')).not.toHaveClass('flex', 'flex-wrap')
      expect(screen.getByTestId('card-my-api').parentElement).toHaveClass('min-w-0')
      expect(screen.getByTestId('card-my-api').parentElement).not.toHaveClass('flex-1')
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

    it('uses labeled integrations skeletons in compact custom tool pages', () => {
      mockIsLoadingToolProviders = true
      renderProviderList(undefined, 'api', 'compact')

      expect(screen.getAllByTestId('tool-card-skeleton')[0]).toHaveAttribute('data-variant', 'integrations-labeled')
    })
  })

  describe('Workflow Tab', () => {
    it('shows workflow collections', () => {
      renderProviderList({ category: 'workflow' })
      expect(screen.getByTestId('card-wf-tool')).toBeInTheDocument()
    })

    it('uses a three-column responsive grid in compact integrations pages', () => {
      renderProviderList(undefined, 'workflow', 'compact')

      expect(screen.getByTestId('tool-provider-grid')).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2', 'md:grid-cols-3')
      expect(screen.getByTestId('tool-provider-grid')).not.toHaveClass('lg:grid-cols-2')
      expect(screen.getByTestId('card-wf-tool').parentElement).toHaveClass('min-w-0')
    })

    it('does not show the built-in badge on workflow cards', () => {
      renderProviderList(undefined, 'workflow', 'compact')

      expect(within(screen.getByTestId('card-wf-tool')).queryByText('dataset.metadata.datasetMetadata.builtIn')).not.toBeInTheDocument()
    })

    it('shows workflow card author and label tags from collection labels', () => {
      renderProviderList(undefined, 'workflow', 'compact')

      const card = within(screen.getByTestId('card-wf-tool'))
      expect(card.getByText('tools.author User')).toBeInTheDocument()
      expect(card.getByText('productivity')).toBeInTheDocument()
      expect(card.getByText('utilities')).toBeInTheDocument()
      expect(card.queryByText(/tools\.mcp\.toolsCount/)).not.toBeInTheDocument()
    })

    it('shows empty state when no workflow collections exist', () => {
      mockCollectionData = createDefaultCollections().filter(c => c.type !== 'workflow')
      renderProviderList({ category: 'workflow' })
      expect(screen.getByTestId('workflow-empty')).toBeInTheDocument()
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

    it('uses labeled integrations skeletons in compact workflow pages', () => {
      mockIsLoadingToolProviders = true
      renderProviderList(undefined, 'workflow', 'compact')

      expect(screen.getAllByTestId('tool-card-skeleton')[0]).toHaveAttribute('data-variant', 'integrations-labeled')
    })
  })

  describe('Builtin Tab Empty State', () => {
    it('shows empty component when no builtin collections', () => {
      mockCollectionData = createDefaultCollections().filter(c => c.type !== 'builtin')
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

    it('uses compact integrations skeletons for built-in tools in compact pages', () => {
      mockIsLoadingToolProviders = true
      renderProviderList(undefined, 'builtin', 'compact')

      expect(screen.getAllByTestId('tool-card-skeleton')[0]).toHaveAttribute('data-variant', 'integrations-default')
    })

    it('renders collection that has no labels property', () => {
      mockCollectionData = [{
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
      }] as unknown as ReturnType<typeof createDefaultCollections>
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

      expect(within(screen.getByTestId('card-google-search')).getByText('dataset.metadata.datasetMetadata.builtIn')).toBeInTheDocument()
      expect(within(screen.getByTestId('card-google-search')).queryByText('plugin.from')).not.toBeInTheDocument()
      expect(within(screen.getByTestId('card-plugin-tool')).queryByText('plugin.from')).not.toBeInTheDocument()
      expect(within(screen.getByTestId('card-plugin-tool')).queryByText('plugin.source.marketplace')).not.toBeInTheDocument()
    })

    it('falls back to the collection name when plugin_id has no package segment', () => {
      mockCollectionData = [{
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
      }]

      renderProviderList()

      expect(screen.getByTestId('card-fallback-plugin-name')).toHaveAttribute('data-org', '')
    })
  })

  describe('MCP Tab', () => {
    it('renders MCPList component', () => {
      renderProviderList({ category: 'mcp' })
      expect(screen.getByTestId('mcp-list')).toBeInTheDocument()
    })

    it('renders MCP list read-only without mcp.manage', () => {
      mockAppContextState.workspacePermissionKeys = ['tool.manage']

      renderProviderList({ category: 'mcp' })

      expect(mockUseAllToolProviders).toHaveBeenCalledWith(undefined)
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

    it('passes compact content inset to MCPList when rendered by integrations layout', () => {
      renderProviderList(undefined, 'mcp', 'compact')

      expect(screen.getByTestId('mcp-list')).toHaveAttribute('data-content-inset', 'compact')
    })
  })

  describe('Provider Detail', () => {
    it('opens provider detail when a non-plugin collection is clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      expect(screen.getByTestId('provider-detail')).toHaveTextContent('google-search')
    })

    it('closes provider detail when close button is clicked', () => {
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-google-search'))
      expect(screen.getByTestId('provider-detail')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('detail-close'))
      expect(screen.queryByTestId('provider-detail')).not.toBeInTheDocument()
    })
  })

  describe('Plugin Detail Panel', () => {
    it('shows plugin detail panel when collection with plugin_id is selected', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      expect(screen.queryByTestId('plugin-detail-panel')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      expect(screen.getByTestId('plugin-detail-panel')).toBeInTheDocument()
    })

    it('calls invalidateInstalledPluginList on plugin update', () => {
      mockCheckedInstalledData = {
        plugins: [{ id: 'org/plugin-tool', name: 'Plugin Tool' }],
      }
      renderProviderList()
      fireEvent.click(screen.getByTestId('card-plugin-tool'))
      fireEvent.click(screen.getByTestId('plugin-update'))
      expect(mockInvalidateInstalledPluginList).toHaveBeenCalled()
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

    it('passes compact content inset to marketplace when rendered by integrations layout', () => {
      mockEnableMarketplace = true
      renderProviderList(undefined, 'builtin', 'compact')

      expect(screen.getByTestId('marketplace')).toHaveAttribute('data-content-inset', 'compact')
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
      const scrollContainer = screen.getByRole('region', { name: 'common.menus.tools' }) as HTMLDivElement
      fireEvent.scroll(scrollContainer)
      expect(mockHandleScroll).toHaveBeenCalled()
    })

    it('updates marketplace arrow visibility on scroll', () => {
      mockEnableMarketplace = true
      renderProviderList()
      expect(screen.getByTestId('marketplace-arrow')).toHaveTextContent('arrow-visible')
      const scrollContainer = screen.getByRole('region', { name: 'common.menus.tools' }) as HTMLDivElement
      fireEvent.scroll(scrollContainer)
      expect(screen.getByTestId('marketplace-arrow')).toHaveTextContent('arrow-hidden')
    })
  })
})
