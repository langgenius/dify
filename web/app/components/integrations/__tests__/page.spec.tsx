import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithNuqs } from '@/test/nuqs-testing'
import IntegrationsPage from '../page'

const { mockRouterPush, mockWindowOpen } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockWindowOpen: vi.fn(),
}))

const mockAppContextState = vi.hoisted(() => ({
  workspacePermissionKeys: ['tool.manage', 'mcp.manage'] as string[],
}))

const {
  mockCanManagement,
  mockCanDebugger,
  mockCanSetPermissions,
  mockReferenceSetting,
  mockSetReferenceSettings,
} = vi.hoisted(() => ({
  mockCanManagement: vi.fn(() => true),
  mockCanDebugger: vi.fn(() => true),
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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: <T,>(selector: (state: { workspacePermissionKeys: string[] }) => T): T => selector({
    workspacePermissionKeys: mockAppContextState.workspacePermissionKeys,
  }),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({
    permission: mockReferenceSetting().permission,
    canInstallPlugin: mockCanManagement(),
    canDeletePlugin: true,
    canManagement: mockCanManagement(),
    canDebugger: mockCanDebugger(),
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
    canUpdatePlugin: true,
    setPluginPermissionSettings: mockSetReferenceSettings,
  }),
  default: () => ({
    referenceSetting: mockReferenceSetting(),
    canInstallPlugin: mockCanManagement(),
    canDeletePlugin: true,
    canManagement: mockCanManagement(),
    canDebugger: mockCanDebugger(),
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
    canUpdatePlugin: true,
    setReferenceSettings: mockSetReferenceSettings,
  }),
}))

vi.mock('@/app/components/plugins/plugin-page/debug-info', () => ({
  __esModule: true,
  default: ({
    triggerClassName,
    triggerContent,
  }: {
    triggerClassName?: string
    triggerContent?: React.ReactNode
  }) => (
    <button type="button" aria-label="plugin debug" className={triggerClassName}>{triggerContent ?? 'debug'}</button>
  ),
}))

vi.mock('@/app/components/plugins/reference-setting-modal', () => ({
  __esModule: true,
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="reference-setting-modal">
      <button type="button" onClick={onHide}>close</button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/update-setting-dialog', () => ({
  __esModule: true,
  default: () => (
    <button
      type="button"
      data-testid="update-setting-dialog"
    >
      plugin.autoUpdate.autoUpdate
      <span>plugin.autoUpdate.strategy.fixOnly.name</span>
    </button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/install-plugin-dropdown', () => ({
  __esModule: true,
  default: ({
    disabled,
    onSwitchToMarketplaceTab,
    showTriggerArrow,
    triggerClassName,
  }: {
    disabled?: boolean
    onSwitchToMarketplaceTab: () => void
    showTriggerArrow?: boolean
    triggerClassName?: string
  }) => (
    <button
      type="button"
      aria-label="plugin install"
      className={triggerClassName}
      data-show-trigger-arrow={String(showTriggerArrow)}
      disabled={disabled}
      onClick={onSwitchToMarketplaceTab}
    >
      install dropdown
    </button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-page/plugin-tasks', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="plugin tasks">tasks</button>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page', () => ({
  __esModule: true,
  default: ({
    layout,
    onSearchTextChange,
    searchText,
  }: {
    layout?: (parts: { body: React.ReactNode, toolbar: React.ReactNode }) => React.ReactNode
    onSearchTextChange?: (value: string) => void
    searchText: string
  }) => {
    const toolbar = (
      <div data-testid="model-provider-toolbar">
        <input
          aria-label="search"
          value={searchText}
          onChange={event => onSearchTextChange?.(event.target.value)}
        />
      </div>
    )
    const body = <div data-testid="model-provider-page" />

    if (layout)
      return layout({ body, toolbar })

    return (
      <div data-testid="model-provider-page">
        <input
          aria-label="search"
          value={searchText}
          onChange={event => onSearchTextChange?.(event.target.value)}
        />
      </div>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/data-source-page-new', () => ({
  __esModule: true,
  default: ({ layout }: { layout?: (parts: { body: React.ReactNode, toolbar: React.ReactNode }) => React.ReactNode }) => {
    const toolbar = <div data-testid="data-source-toolbar" />
    const body = <div data-testid="data-source-page" />

    if (layout)
      return layout({ body, toolbar })

    return body
  },
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page', () => ({
  __esModule: true,
  ApiBasedExtensionPage: ({ layout }: { layout?: (parts: { body: React.ReactNode, toolbar: React.ReactNode }) => React.ReactNode }) => {
    const toolbar = <div data-testid="api-extension-toolbar" />
    const body = <div data-testid="api-extension-page" />

    if (layout)
      return layout({ body, toolbar })

    return body
  },
}))

vi.mock('../tool-provider-list', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react')

  const MockProviderList = ({ category, layout }: { category?: string, layout?: (parts: { body: React.ReactNode, toolbar: React.ReactNode }) => React.ReactNode }) => {
    const [mountedCategory] = useState(category)
    const toolbar = <div data-testid="tool-provider-toolbar" />
    const body = <div data-testid="tool-provider-list" data-mounted-category={mountedCategory}>{category}</div>

    if (layout)
      return layout({ body, toolbar })

    return body
  }

  return {
    __esModule: true,
    default: MockProviderList,
  }
})

vi.mock('../plugin-category-page', () => ({
  __esModule: true,
  default: ({ canInstall, category, layout, onSwitchToMarketplace, toolbarAction }: { canInstall?: boolean, category: string, layout?: (parts: { body: React.ReactNode, toolbar: React.ReactNode }) => React.ReactNode, onSwitchToMarketplace?: () => void, toolbarAction?: React.ReactNode }) => {
    const toolbar = <div data-testid="plugin-category-toolbar">{toolbarAction}</div>
    const body = (
      <div data-can-install={canInstall ? 'true' : 'false'} data-testid={`plugin-category-${category}`}>
        <button type="button" aria-label="empty marketplace" onClick={onSwitchToMarketplace}>marketplace</button>
      </div>
    )

    if (layout)
      return layout({ body, toolbar })

    return (
      <>
        {toolbar}
        {body}
      </>
    )
  },
}))

const renderIntegrationsPage = (
  searchParams?: Record<string, string>,
  sectionOrProps?: React.ComponentProps<typeof IntegrationsPage>['section'] | Partial<React.ComponentProps<typeof IntegrationsPage>>,
) => {
  const props = typeof sectionOrProps === 'string'
    ? { section: sectionOrProps }
    : sectionOrProps

  return renderWithNuqs(<IntegrationsPage {...props} />, { searchParams })
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('open', mockWindowOpen)
    mockCanManagement.mockReturnValue(true)
    mockCanDebugger.mockReturnValue(true)
    mockCanSetPermissions.mockReturnValue(true)
    mockAppContextState.workspacePermissionKeys = ['tool.manage', 'mcp.manage']
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
  })

  it('defaults to the model provider section when no query is provided', () => {
    const { container } = renderIntegrationsPage()

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getAllByText('common.settings.provider')).toHaveLength(2)
    expect(container.firstElementChild).toHaveClass('bg-components-panel-bg')
    expect(container.querySelector('aside')).toHaveClass('bg-components-panel-bg')
  })

  it('renders the model provider section from the section query', () => {
    renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getByTestId('model-provider-toolbar').closest('[class*="max-w-[1600px]"]')).toHaveClass('px-6', 'pt-3', 'pb-2')
    expect(within(screen.getByTestId('model-provider-toolbar').closest('section')!).getByText('common.settings.provider')).toHaveClass('title-2xl-semi-bold')
    expect(screen.getByTestId('model-provider-page').parentElement).toHaveClass('max-w-[1600px]', 'px-6')
    expect(screen.getByTestId('model-provider-page').parentElement).not.toHaveClass('pt-2')
    expect(screen.getAllByText('common.settings.provider')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'common.settings.provider' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'common.settings.dataSource' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('textbox', { name: 'search' })).toBeInTheDocument()
  })

  it('orders sidebar items to match the integrations setting menu', () => {
    renderIntegrationsPage({ section: 'provider' })

    const navText = screen.getByRole('navigation').textContent ?? ''

    expect(navText.indexOf('common.settings.provider')).toBeLessThan(navText.indexOf('common.menus.tools'))
    expect(navText.indexOf('common.menus.tools')).toBeLessThan(navText.indexOf('common.settings.dataSource'))
    expect(navText.indexOf('common.settings.dataSource')).toBeLessThan(navText.indexOf('plugin.categorySingle.trigger'))
    expect(navText.indexOf('plugin.categorySingle.trigger')).toBeLessThan(navText.indexOf('plugin.categorySingle.agent'))
    expect(navText.indexOf('plugin.categorySingle.agent')).toBeLessThan(navText.indexOf('plugin.categorySingle.extension'))
    expect(navText.indexOf('plugin.categorySingle.extension')).toBeLessThan(navText.indexOf('common.settings.customEndpoint'))
  })

  it('keeps sidebar item icons outlined when the item is active', () => {
    const providerView = renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByRole('link', { name: 'common.settings.dataSource' }).querySelector('.i-ri-database-2-line')).toBeInTheDocument()

    providerView.rerender(<IntegrationsPage section="data-source" />)

    expect(screen.getByRole('link', { name: 'common.settings.dataSource' }).querySelector('.i-ri-database-2-line')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.dataSource' }).querySelector('.i-ri-database-2-fill')).not.toBeInTheDocument()
  })

  it('renders plugin category sections from the section query', () => {
    const toolView = renderIntegrationsPage({ section: 'builtin' })

    expect(screen.getByTestId('plugin-category-tool')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-category-tool').parentElement).toHaveClass('flex', 'flex-col', 'overflow-hidden')
    expect(screen.getByRole('link', { name: 'common.toolsPage.toolPlugin' })).toHaveAttribute('href', '/integrations/tools/built-in')

    toolView.unmount()
    const triggerView = renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByTestId('plugin-category-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-category-trigger').parentElement).toHaveClass('flex', 'flex-col', 'overflow-hidden')
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.trigger' })).toHaveAttribute('href', '/integrations/trigger')

    triggerView.unmount()
    const agentStrategyView = renderIntegrationsPage({ section: 'agent-strategy' })

    expect(screen.getByTestId('plugin-category-agent-strategy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.agent' })).toHaveAttribute('href', '/integrations/agent-strategy')

    agentStrategyView.unmount()
    renderIntegrationsPage({ section: 'extension' })

    expect(screen.getByTestId('plugin-category-extension')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.extension' })).toHaveAttribute('href', '/integrations/extension')
  })

  it('opens the integrations marketplace path from plugin category empty states', () => {
    renderIntegrationsPage({ section: 'extension' })

    fireEvent.click(screen.getByRole('button', { name: 'empty marketplace' }))

    expect(mockWindowOpen).toHaveBeenCalledWith(
      expect.stringContaining('/plugins/extension?source='),
      '_blank',
      'noopener,noreferrer',
    )
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('passes marketplace platform paths to external marketplace callbacks', () => {
    const onSwitchToMarketplace = vi.fn()
    renderIntegrationsPage({ section: 'trigger' }, { onSwitchToMarketplace })

    fireEvent.click(screen.getByRole('button', { name: 'empty marketplace' }))

    expect(onSwitchToMarketplace).toHaveBeenCalledWith('/plugins/trigger')
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('renders migrated legacy setting sections', () => {
    const { unmount } = renderIntegrationsPage({ section: 'data-source' })

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin debug' })).toHaveTextContent('plugin.debugInfo.title')

    unmount()
    renderIntegrationsPage({ section: 'custom-endpoint' })

    expect(screen.getByTestId('api-extension-page')).toBeInTheDocument()
    expect(screen.queryByText('plugin.autoUpdate.autoUpdate')).not.toBeInTheDocument()
  })

  it('hides the plugin debug action when debug permission is unavailable', () => {
    mockCanDebugger.mockReturnValue(false)

    renderIntegrationsPage({ section: 'data-source' })

    expect(screen.queryByLabelText('plugin.privilege.noDebugPermissionTooltip')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin debug' })).not.toBeInTheDocument()
  })

  it('renders existing pages from route sections', () => {
    const modelProviderView = renderIntegrationsPage(undefined, 'provider')

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()

    modelProviderView.unmount()
    const mcpView = renderIntegrationsPage(undefined, 'mcp')

    expect(screen.getByTestId('tool-provider-list')).toHaveTextContent('mcp')
    expect(screen.getByTestId('tool-provider-list').parentElement).toHaveClass('flex', 'flex-col', 'overflow-hidden')

    mcpView.unmount()
    renderIntegrationsPage(undefined, 'data-source')

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
  })

  it('renders the MCP route as read-only without mcp.manage', () => {
    mockAppContextState.workspacePermissionKeys = ['tool.manage']

    renderIntegrationsPage(undefined, 'mcp')

    expect(screen.getByTestId('tool-provider-list')).toHaveTextContent('mcp')
  })

  it.each(['custom-tool', 'workflow-tool'] as const)('renders the %s route as read-only without tool.manage', (section) => {
    mockAppContextState.workspacePermissionKeys = ['mcp.manage']

    renderIntegrationsPage(undefined, section)

    expect(screen.getByTestId('tool-provider-list')).toBeInTheDocument()
  })

  it('remounts the tools section content when the route section changes', () => {
    const view = renderIntegrationsPage(undefined, 'builtin')

    expect(screen.getByTestId('plugin-category-tool')).toBeInTheDocument()

    view.rerender(<IntegrationsPage section="mcp" />)

    expect(screen.getByTestId('tool-provider-list')).toHaveAttribute('data-mounted-category', 'mcp')
  })

  it('keeps existing category-only tools URLs functional', () => {
    renderIntegrationsPage({ category: 'mcp' })

    expect(screen.getByTestId('tool-provider-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.menus.tools' })).not.toHaveClass('bg-state-base-active')
    expect(screen.getByRole('button', { name: 'common.menus.tools' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'common.toolsPage.toolPlugin' })).toHaveAttribute('href', '/integrations/tools/built-in')
    expect(screen.getByRole('link', { name: 'common.toolsPage.toolPlugin' })).toHaveClass('pl-8')
    expect(screen.getByRole('link', { name: 'common.toolsPage.toolPlugin' }).querySelector('.i-custom-vender-integrations-tools')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute('href', '/integrations/tools/mcp')
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveClass('bg-state-base-active')
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'common.settings.swaggerAPIAsTool' })).toHaveAttribute('href', '/integrations/tools/api')
    expect(screen.getByRole('link', { name: 'workflow.common.workflowAsTool' })).toHaveAttribute('href', '/integrations/tools/workflow')
    const workflowToolIcon = screen.getByRole('link', { name: 'workflow.common.workflowAsTool' }).querySelector('.i-custom-vender-integrations-workflow-as-tool')
    expect(workflowToolIcon).toBeInTheDocument()
    expect(workflowToolIcon).toHaveClass('size-4')
    expect(screen.getByRole('link', { name: 'workflow.common.workflowAsTool' }).querySelector('.i-ri-node-tree')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'workflow.common.workflowAsTool' }).compareDocumentPosition(screen.getByRole('link', { name: 'common.settings.swaggerAPIAsTool' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('uses hover-only arrows for the tools parent icon', () => {
    const view = renderIntegrationsPage({ section: 'provider' })

    const collapsedToolsButton = screen.getByRole('button', { name: 'common.menus.tools' })
    const collapsedDisclosureIcon = collapsedToolsButton.querySelector('svg[viewBox="0 0 12 14.0003"]')

    expect(collapsedToolsButton).toHaveAttribute('aria-expanded', 'false')
    expect(collapsedDisclosureIcon).toBeInTheDocument()
    expect(collapsedDisclosureIcon).toHaveClass('h-3.5', 'w-3', 'group-hover:hidden')
    expect(collapsedToolsButton.querySelector('[data-icon="MagicBox"]')).not.toBeInTheDocument()
    expect(collapsedToolsButton.querySelector('.i-custom-vender-solid-mediaAndDevices-magic-box')).not.toBeInTheDocument()
    expect(collapsedToolsButton.querySelector('.i-custom-vender-plugin-box-sparkle-fill')).not.toBeInTheDocument()
    expect(collapsedToolsButton.querySelector('.i-ri-arrow-down-s-line')).toHaveClass('hidden', 'group-hover:inline-block')
    expect(collapsedToolsButton.querySelector('.i-ri-arrow-up-s-line')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'common.toolsPage.toolPlugin' })).not.toBeInTheDocument()

    view.unmount()
    renderIntegrationsPage({ section: 'mcp' })

    const expandedToolsButton = screen.getByRole('button', { name: 'common.menus.tools' })
    const expandedDisclosureIcon = expandedToolsButton.querySelector('svg[viewBox="0 0 12 14.0003"]')

    expect(expandedToolsButton).toHaveAttribute('aria-expanded', 'true')
    expect(expandedToolsButton).not.toHaveClass('bg-state-base-active')
    expect(expandedToolsButton).not.toHaveAttribute('aria-current')
    expect(expandedDisclosureIcon).toBeInTheDocument()
    expect(expandedToolsButton.querySelector('.i-ri-arrow-up-s-line')).toHaveClass('hidden', 'group-hover:inline-block')
    expect(expandedToolsButton.querySelector('.i-ri-arrow-down-s-line')).not.toBeInTheDocument()
    expect(expandedToolsButton.querySelector('.i-custom-vender-integrations-tools-active')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.toolsPage.toolPlugin' })).toHaveAttribute('href', '/integrations/tools/built-in')
  })

  it('toggles the tools submenu without other nav items closing it', () => {
    const onSectionChange = vi.fn()
    renderWithNuqs(<IntegrationsPage section="provider" onSectionChange={onSectionChange} />)

    expect(screen.getByRole('button', { name: 'common.settings.provider' })).toHaveClass('bg-state-base-active')

    const toolsButton = screen.getByRole('button', { name: 'common.menus.tools' })

    expect(toolsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()

    fireEvent.click(toolsButton)

    expect(onSectionChange).toHaveBeenCalledWith('builtin')
    expect(toolsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'common.toolsPage.toolPlugin' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.settings.provider' }))

    expect(onSectionChange).toHaveBeenCalledWith('provider')
    expect(toolsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument()

    fireEvent.click(toolsButton)

    expect(toolsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
    expect(onSectionChange).toHaveBeenCalledTimes(2)
  })

  it('keeps custom, workflow, and MCP tool entries visible without manage permissions', () => {
    mockAppContextState.workspacePermissionKeys = ['mcp.manage']
    renderIntegrationsPage(undefined, { section: 'provider', onSectionChange: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: 'common.menus.tools' }))

    expect(screen.getByRole('button', { name: 'common.toolsPage.toolPlugin' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workflow.common.workflowAsTool' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.settings.swaggerAPIAsTool' })).toBeInTheDocument()
  })

  it('opens tools to the tools plugin page when the parent tools nav is clicked', () => {
    renderIntegrationsPage(undefined, 'provider')

    fireEvent.click(screen.getByRole('button', { name: 'common.menus.tools' }))

    expect(mockRouterPush).toHaveBeenCalledWith('/integrations/tools/built-in')
  })

  it('keeps the tools disclosure independent from route section changes', () => {
    const view = renderIntegrationsPage(undefined, 'mcp')

    expect(screen.getByTestId('tool-provider-list')).toHaveAttribute('data-mounted-category', 'mcp')
    expect(screen.getByRole('button', { name: 'common.menus.tools' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'common.toolsPage.toolPlugin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.menus.tools' }))

    expect(screen.getByTestId('tool-provider-list')).toHaveAttribute('data-mounted-category', 'mcp')
    expect(screen.getByRole('button', { name: 'common.menus.tools' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'common.toolsPage.toolPlugin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument()

    view.rerender(<IntegrationsPage section="provider" />)

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.menus.tools' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'common.toolsPage.toolPlugin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument()
  })

  it('renders the tools header for tool sections', () => {
    renderIntegrationsPage({ section: 'builtin' })

    expect(screen.getAllByText('common.toolsPage.toolPlugin')).toHaveLength(2)
    expect(screen.getByText('common.toolsPage.description')).toBeInTheDocument()
    expect(screen.getByText('common.toolsPage.description').closest('[class*="max-w-[1600px]"]')).toHaveClass('px-6')
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/tools')
  })

  it('aligns model provider headers to the unified content frame', () => {
    renderIntegrationsPage({ section: 'provider' })

    const description = screen.getByText('common.modelProvider.pageDesc')
    expect(description.closest('[class*="max-w-[1600px]"]')).toHaveClass('px-6')
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toBeInTheDocument()
  })

  it('aligns plugin category headers to the unified content frame', () => {
    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByText('common.triggerPage.description').closest('[class*="max-w-[1600px]"]')).toHaveClass('px-6')
  })

  it('renders the mcp header for the mcp section', () => {
    renderIntegrationsPage({ section: 'mcp' })

    expect(screen.getAllByText('MCP')).toHaveLength(2)
    expect(screen.getByText('common.mcpPage.description')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/build/mcp')
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the custom tool header for the custom tool section', () => {
    renderIntegrationsPage({ section: 'custom-tool' })

    expect(screen.getAllByText('common.settings.swaggerAPIAsTool')).toHaveLength(2)
    expect(screen.getByText('common.swaggerAPIAsToolPage.description')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/tools#custom-tool')
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each([
    ['data-source', 'common.settings.dataSource', 'common.dataSourcePage.description', 'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/datasource-plugin#data-source-plugin-types'],
  ] as const)('renders the %s header with a docs link', (section, title, description, href) => {
    renderIntegrationsPage({ section })

    expect(screen.getAllByText(title)).toHaveLength(2)
    expect(screen.getByText(description)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', href)
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the custom endpoint header with toolbar and docs link', () => {
    renderIntegrationsPage({ section: 'custom-endpoint' })

    expect(screen.getAllByText('common.settings.customEndpoint')).toHaveLength(2)
    expect(screen.getByText('common.apiBasedExtensionPage.description')).toBeInTheDocument()
    expect(screen.getByTestId('api-extension-toolbar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/api-extension/api-extension')
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each([
    ['trigger', 'plugin.categorySingle.trigger', 'common.triggerPage.description', 'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/trigger-plugin'],
    ['extension', 'plugin.categorySingle.extension', 'common.extensionPage.description', 'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/endpoint'],
    ['agent-strategy', 'plugin.categorySingle.agent', 'common.agentStrategyPage.description', 'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/agent-strategy-plugin'],
  ] as const)('renders the %s header with a docs link', (section, title, description, href) => {
    renderIntegrationsPage({ section })

    expect(screen.getAllByText(title)).toHaveLength(2)
    expect(screen.getByText(description)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', href)
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the workflow as tool header with a docs link', () => {
    renderIntegrationsPage({ section: 'workflow-tool' })

    expect(screen.getAllByText('workflow.common.workflowAsTool')).toHaveLength(2)
    expect(screen.getByText('common.workflowAsToolPage.description')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.modelProvider\.learnMore/i })).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/tools#workflow-tool')
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each([
    ['builtin', 'common.toolsPage.description'],
    ['mcp', 'common.mcpPage.description'],
    ['custom-tool', 'common.swaggerAPIAsToolPage.description'],
    ['workflow-tool', 'common.workflowAsToolPage.description'],
    ['custom-endpoint', 'common.apiBasedExtensionPage.description'],
    ['data-source', 'common.dataSourcePage.description'],
    ['trigger', 'common.triggerPage.description'],
    ['extension', 'common.extensionPage.description'],
    ['agent-strategy', 'common.agentStrategyPage.description'],
  ] as const)('renders an unbordered header for %s', (section, description) => {
    renderIntegrationsPage({ section })

    expect(screen.getByText(description).parentElement?.parentElement?.parentElement).not.toHaveClass('border-b', 'border-divider-subtle')
  })

  it.each(['builtin', 'trigger', 'extension', 'agent-strategy'] as const)('renders plugin update settings action in the category toolbar for %s', (section) => {
    renderIntegrationsPage({ section })

    expect(screen.getByText('plugin.autoUpdate.autoUpdate')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.strategy.fixOnly.name')).toBeInTheDocument()
  })

  it('opens the integrations marketplace path from the install dropdown marketplace action', () => {
    renderIntegrationsPage({ section: 'builtin' })

    fireEvent.click(screen.getByRole('button', { name: 'plugin install' }))

    expect(mockWindowOpen).toHaveBeenCalledWith(
      expect.stringContaining('/plugins/tool?source='),
      '_blank',
      'noopener,noreferrer',
    )
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('hides the install action and category installs when install permission is unavailable', () => {
    mockCanManagement.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.queryByLabelText('plugin.privilege.noInstallPermissionTooltip')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin install' })).not.toBeInTheDocument()
    expect(screen.getByTestId('plugin-category-trigger')).toHaveAttribute('data-can-install', 'false')
  })

  it('hides the debug action when debug permission is unavailable', () => {
    mockCanDebugger.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.queryByLabelText('plugin.privilege.noDebugPermissionTooltip')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin debug' })).not.toBeInTheDocument()
  })

  it('hides plugin update settings action when permission management is unavailable', () => {
    mockCanSetPermissions.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.queryByTestId('update-setting-dialog')).not.toBeInTheDocument()
  })

  it('opens the sidebar plugin permissions quick settings and updates permissions', () => {
    renderIntegrationsPage({ section: 'provider' })

    fireEvent.click(screen.getByRole('button', { name: 'plugin.privilege.permissions' }))

    expect(screen.getAllByText('plugin.privilege.permissions').length).toBeGreaterThan(0)
    expect(screen.getByText('plugin.privilege.quickWhoCanInstall')).toBeInTheDocument()
    expect(screen.getByText('plugin.privilege.quickWhoCanDebug')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('plugin.privilege.permissions').closest('.w-\\[360px\\]')).toHaveClass('rounded-2xl', 'shadow-2xl')
    expect(screen.getByRole('radio', { name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.everyone' })).toHaveClass('w-[104px]', 'h-8')

    fireEvent.click(screen.getByRole('radio', { name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.noone' }))

    expect(mockSetReferenceSettings).toHaveBeenCalledWith({
      install_permission: 'noone',
      debug_permission: 'admins',
    })
  })

  it('hides the sidebar plugin permissions quick settings when permission management is unavailable', () => {
    mockCanSetPermissions.mockReturnValue(false)
    renderIntegrationsPage({ section: 'provider' })

    expect(screen.queryByRole('button', { name: 'plugin.privilege.permissions' })).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.privilege.quickWhoCanInstall')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.privilege.quickWhoCanDebug')).not.toBeInTheDocument()
  })

  it('uses the no-action sidebar spacing when install permission is unavailable', () => {
    mockCanManagement.mockReturnValue(false)

    renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByText('common.settings.integrations').parentElement?.parentElement).toHaveClass('mb-3', 'pt-1', 'pb-0.5')
    expect(screen.getByRole('link', { name: 'common.settings.provider' }).parentElement).toHaveClass('py-4')
  })

  it('keeps the integrations sidebar expanded without a collapse control', () => {
    const { container } = renderIntegrationsPage({ section: 'provider' })

    expect(container.firstElementChild).toHaveStyle({
      '--model-provider-warning-left': 'calc(240px + 200px)',
    })

    expect(screen.getByText('common.settings.integrations')).toBeInTheDocument()
    expect(screen.getByText('common.settings.integrations')).toHaveClass('title-2xl-semi-bold', 'text-text-primary')
    expect(screen.getByText('common.settings.integrations').parentElement).toHaveClass('h-6', 'items-center')
    expect(screen.getByRole('button', { name: 'plugin install' })).toHaveAttribute('data-show-trigger-arrow', 'false')
    expect(screen.getByRole('button', { name: 'plugin install' })).toHaveClass('justify-start')
    expect(screen.getByRole('button', { name: 'plugin tasks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin debug' })).toHaveTextContent('plugin.debugInfo.title')
    expect(screen.getByRole('button', { name: 'plugin debug' })).toHaveClass('h-8', 'w-full', 'gap-2', 'rounded-lg', 'py-1', 'pr-1', 'pl-2', 'system-sm-medium')
    expect(screen.getByRole('button', { name: 'plugin debug' }).parentElement).toHaveClass('w-46')
    expect(screen.getByRole('button', { name: 'plugin.privilege.permissions' })).toHaveTextContent('plugin.privilege.permissions')
    expect(screen.getByRole('button', { name: 'plugin.privilege.permissions' })).toHaveClass('h-8', 'w-full', 'gap-2', 'rounded-lg', 'py-1', 'pr-1', 'pl-2', 'system-sm-medium')
    expect(screen.queryByText('common.settings.swaggerAPIAsTool')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.customEndpoint' })).toHaveAttribute('href', '/integrations/custom-endpoint')
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.trigger' })).toHaveAttribute('href', '/integrations/trigger')
    expect(screen.queryByRole('button', { name: 'common.settings.collapse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.settings.expand' })).not.toBeInTheDocument()
  })
})
