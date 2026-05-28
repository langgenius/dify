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
  default: () => <button type="button" aria-label="plugin debug">debug</button>,
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
  default: ({ disabled, onSwitchToMarketplaceTab }: { disabled?: boolean, onSwitchToMarketplaceTab: () => void }) => (
    <button type="button" aria-label="plugin install" disabled={disabled} onClick={onSwitchToMarketplaceTab}>
      install dropdown
    </button>
  ),
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

  it('places data source directly under model provider in the sidebar', () => {
    renderIntegrationsPage({ section: 'provider' })

    const navText = screen.getByRole('navigation').textContent ?? ''

    expect(navText.indexOf('common.settings.provider')).toBeLessThan(navText.indexOf('common.settings.dataSource'))
    expect(navText.indexOf('common.settings.dataSource')).toBeLessThan(navText.indexOf('common.menus.tools'))
  })

  it('renders the Figma-matched database icon for the data source sidebar item', () => {
    const providerView = renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByRole('link', { name: 'common.settings.dataSource' }).querySelector('.i-ri-database-2-line')).toBeInTheDocument()

    providerView.rerender(<IntegrationsPage section="data-source" />)

    expect(screen.getByRole('link', { name: 'common.settings.dataSource' }).querySelector('.i-ri-database-2-fill')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'plugin debug' }).parentElement).toHaveClass('size-8', 'shrink-0')

    unmount()
    renderIntegrationsPage({ section: 'api-based-extension' })

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
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveClass('bg-state-base-active')
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute('href', '/integrations/tools/mcp')
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
    ['api-based-extension', 'common.settings.apiBasedExtension', 'common.apiBasedExtensionPage.description'],
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
    ['api-based-extension', 'common.apiBasedExtensionPage.description'],
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

    expect(screen.getByText('plugin.privilege.permissions')).toBeInTheDocument()
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
    expect(screen.getByText('common.settings.customTool')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.trigger' })).toHaveAttribute('href', '/integrations/trigger')
    expect(screen.queryByRole('button', { name: 'common.settings.collapse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.settings.expand' })).not.toBeInTheDocument()
  })
})
