import { fireEvent, screen } from '@testing-library/react'
import { renderWithNuqs } from '@/test/nuqs-testing'
import IntegrationsPage from '../page'

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
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

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({
    permission: mockReferenceSetting().permission,
    canManagement: mockCanManagement(),
    canDebugger: mockCanDebugger(),
    canSetPermissions: mockCanSetPermissions(),
    setPluginPermissionSettings: mockSetReferenceSettings,
  }),
  default: () => ({
    referenceSetting: mockReferenceSetting(),
    canManagement: mockCanManagement(),
    canDebugger: mockCanDebugger(),
    canSetPermissions: mockCanSetPermissions(),
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

vi.mock('@/app/components/header/account-setting/update-setting-popover', () => ({
  __esModule: true,
  default: () => (
    <button
      type="button"
      data-testid="update-setting-popover"
    >
      common.modelProvider.updateSetting
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
    fixedWarningAlignment,
    layout,
    onSearchTextChange,
    searchText,
  }: {
    fixedWarningAlignment?: string
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
    const body = (
      <div data-testid="model-provider-page" data-fixed-warning-alignment={fixedWarningAlignment} />
    )

    if (layout)
      return layout({ body, toolbar })

    return (
      <div data-testid="model-provider-page" data-fixed-warning-alignment={fixedWarningAlignment}>
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
  default: () => <div data-testid="data-source-page" />,
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page', () => ({
  __esModule: true,
  ApiBasedExtensionPage: () => <div data-testid="api-extension-page" />,
}))

vi.mock('../tool-provider-list', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react')

  const MockProviderList = ({ category }: { category?: string }) => {
    const [mountedCategory] = useState(category)

    return <div data-testid="tool-provider-list" data-mounted-category={mountedCategory}>{category}</div>
  }

  return {
    __esModule: true,
    default: MockProviderList,
  }
})

vi.mock('../plugin-category-page', () => ({
  __esModule: true,
  default: ({ canInstall, category, onSwitchToMarketplace, toolbarAction }: { canInstall?: boolean, category: string, onSwitchToMarketplace?: () => void, toolbarAction?: React.ReactNode }) => (
    <div data-can-install={canInstall ? 'true' : 'false'} data-testid={`plugin-category-${category}`}>
      <button type="button" aria-label="empty marketplace" onClick={onSwitchToMarketplace}>marketplace</button>
      {toolbarAction}
    </div>
  ),
}))

const renderIntegrationsPage = (searchParams?: Record<string, string>, section?: React.ComponentProps<typeof IntegrationsPage>['section']) => {
  return renderWithNuqs(<IntegrationsPage section={section} />, { searchParams })
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanManagement.mockReturnValue(true)
    mockCanDebugger.mockReturnValue(true)
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
    expect(screen.getByTestId('model-provider-toolbar').parentElement).toHaveClass('max-w-[1600px]', 'px-6', 'pt-2')
    expect(screen.getByTestId('model-provider-page').parentElement).toHaveClass('max-w-[1600px]', 'px-6')
    expect(screen.getByTestId('model-provider-page').parentElement).not.toHaveClass('pt-2')
    expect(screen.getByTestId('model-provider-page')).toHaveAttribute('data-fixed-warning-alignment', 'content-frame')
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

    expect(mockRouterPush).toHaveBeenCalledWith('/marketplace?category=extension')
  })

  it('renders migrated legacy setting sections', () => {
    const { unmount } = renderIntegrationsPage({ section: 'data-source' })

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin debug' })).toHaveTextContent('plugin.debugInfo.title')

    unmount()
    renderIntegrationsPage({ section: 'custom-endpoint' })

    expect(screen.getByTestId('api-extension-page')).toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.updateSetting')).not.toBeInTheDocument()
  })

  it('disables the plugin debug action when debug permission is unavailable', () => {
    mockCanDebugger.mockReturnValue(false)

    renderIntegrationsPage({ section: 'data-source' })

    expect(screen.getByLabelText('plugin.privilege.noDebugPermissionTooltip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.debugInfo.title' })).toBeDisabled()
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

  it('remounts the tools section content when the route section changes', () => {
    const view = renderIntegrationsPage(undefined, 'builtin')

    expect(screen.getByTestId('tool-provider-list')).toHaveAttribute('data-mounted-category', 'builtin')

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
    expect(screen.getByRole('link', { name: 'common.settings.customTool' })).toHaveAttribute('href', '/integrations/tool/api')
    expect(screen.getByRole('link', { name: 'workflow.common.workflowAsTool' })).toHaveAttribute('href', '/integrations/tools/workflow')
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

    expect(screen.getAllByText('common.menus.tools')).toHaveLength(2)
    expect(screen.getByText('common.toolsPage.description')).toBeInTheDocument()
    expect(screen.getByText('common.toolsPage.description').parentElement?.parentElement).toHaveClass('max-w-[1600px]', 'px-6')
  })

  it('aligns model provider headers to the unified content frame', () => {
    renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByText('common.modelProvider.pageDesc').parentElement?.parentElement).toHaveClass('max-w-[1600px]', 'px-6')
  })

  it('aligns plugin category headers to the unified content frame', () => {
    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByText('common.triggerPage.description').parentElement?.parentElement).toHaveClass('max-w-[1600px]', 'px-6')
  })

  it('renders the mcp header for the mcp section', () => {
    renderIntegrationsPage({ section: 'mcp' })

    expect(screen.getAllByText('MCP')).toHaveLength(2)
    expect(screen.getByText('common.mcpPage.description')).toBeInTheDocument()
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the custom tool header for the custom tool section', () => {
    renderIntegrationsPage({ section: 'custom-tool' })

    expect(screen.getAllByText('common.settings.customTool')).toHaveLength(2)
    expect(screen.getByText('common.swaggerAPIAsToolPage.description')).toBeInTheDocument()
    expect(screen.queryByText('common.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each([
    ['workflow-tool', 'workflow.common.workflowAsTool', 'common.workflowAsToolPage.description'],
    ['custom-endpoint', 'common.settings.customEndpoint', 'common.apiBasedExtensionPage.description'],
    ['data-source', 'common.settings.dataSource', 'common.dataSourcePage.description'],
    ['trigger', 'plugin.categorySingle.trigger', 'common.triggerPage.description'],
    ['extension', 'plugin.categorySingle.extension', 'common.extensionPage.description'],
    ['agent-strategy', 'plugin.categorySingle.agent', 'common.agentStrategyPage.description'],
  ] as const)('renders the %s header', (section, title, description) => {
    renderIntegrationsPage({ section })

    expect(screen.getAllByText(title)).toHaveLength(2)
    expect(screen.getByText(description)).toBeInTheDocument()
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

  it.each(['trigger', 'extension', 'agent-strategy'] as const)('renders plugin update settings action in the category toolbar for %s', (section) => {
    renderIntegrationsPage({ section })

    expect(screen.getByText('common.modelProvider.updateSetting')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.strategy.fixOnly.name')).toBeInTheDocument()
  })

  it('opens the integrations marketplace path from the install dropdown marketplace action', () => {
    renderIntegrationsPage({ section: 'builtin' })

    fireEvent.click(screen.getByRole('button', { name: 'plugin install' }))

    expect(mockRouterPush).toHaveBeenCalledWith('/marketplace?category=tool')
  })

  it('disables the install action and category installs when install permission is unavailable', () => {
    mockCanManagement.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByLabelText('plugin.privilege.noInstallPermissionTooltip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin install' })).toBeDisabled()
    expect(screen.getByTestId('plugin-category-trigger')).toHaveAttribute('data-can-install', 'false')
  })

  it('disables the debug action when debug permission is unavailable', () => {
    mockCanDebugger.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByLabelText('plugin.privilege.noDebugPermissionTooltip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.debugInfo.title' })).toBeDisabled()
  })

  it('hides plugin update settings action when permission management is unavailable', () => {
    mockCanSetPermissions.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(screen.queryByTestId('update-setting-popover')).not.toBeInTheDocument()
  })

  it('opens the sidebar plugin permissions quick settings and updates permissions', () => {
    renderIntegrationsPage({ section: 'provider' })

    fireEvent.click(screen.getByRole('button', { name: 'plugin.privilege.permissions' }))

    expect(screen.getAllByText('plugin.privilege.permissions').length).toBeGreaterThan(0)
    expect(screen.getByText('plugin.privilege.quickWhoCanInstall')).toBeInTheDocument()
    expect(screen.getByText('plugin.privilege.quickWhoCanDebug')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.noone' }))

    expect(mockSetReferenceSettings).toHaveBeenCalledWith({
      install_permission: 'noone',
      debug_permission: 'admins',
    })
  })

  it('disables the sidebar plugin permissions quick settings when permission management is unavailable', () => {
    mockCanSetPermissions.mockReturnValue(false)
    renderIntegrationsPage({ section: 'provider' })

    const trigger = screen.getByRole('button', { name: 'plugin.privilege.permissions' })

    expect(trigger).toBeDisabled()

    fireEvent.click(trigger)

    expect(screen.queryByText('plugin.privilege.quickWhoCanInstall')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.privilege.quickWhoCanDebug')).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'plugin debug' }).parentElement?.parentElement).toHaveClass('w-46')
    expect(screen.getByRole('button', { name: 'plugin.privilege.permissions' })).toHaveTextContent('plugin.privilege.permissions')
    expect(screen.getByRole('button', { name: 'plugin.privilege.permissions' })).toHaveClass('h-8', 'w-full', 'gap-2', 'rounded-lg', 'py-1', 'pr-1', 'pl-2', 'system-sm-medium')
    expect(screen.queryByText('common.settings.customTool')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.customEndpoint' })).toHaveAttribute('href', '/integrations/custom-endpoint')
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.trigger' })).toHaveAttribute('href', '/integrations/trigger')
    expect(screen.queryByRole('button', { name: 'common.settings.collapse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.settings.expand' })).not.toBeInTheDocument()
  })
})
