import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import IntegrationsPage from '../index'

const renderWithNuqs = (
  ui: React.ReactElement,
  options: Parameters<typeof createNuqsTestWrapper>[0] = {},
) => {
  const { wrapper: ConsoleQueryWrapper } = createConsoleQueryWrapper()
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper(options)
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConsoleQueryWrapper>
      <NuqsWrapper>{children}</NuqsWrapper>
    </ConsoleQueryWrapper>
  )

  return {
    ...render(ui, { wrapper: Wrapper }),
    onUrlUpdate,
  }
}

const { mockRouterPush, mockWindowOpen } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockWindowOpen: vi.fn(),
}))

const {
  mockCanManagement,
  mockCanDebugger,
  mockCanSetPermissions,
  mockIsPermissionLoading,
  mockReferenceSetting,
  mockSetReferenceSettings,
} = vi.hoisted(() => ({
  mockCanManagement: vi.fn(() => true),
  mockCanDebugger: vi.fn(() => true),
  mockCanSetPermissions: vi.fn(() => true),
  mockIsPermissionLoading: vi.fn(() => false),
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
    canInstallPlugin: mockCanManagement(),
    canDeletePlugin: true,
    canManagement: mockCanManagement(),
    canDebugger: mockCanDebugger(),
    canSetPermissions: mockCanSetPermissions(),
    canSetPluginPreferences: mockCanSetPermissions(),
    canUpdatePlugin: true,
    isPermissionLoading: mockIsPermissionLoading(),
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
    isPermissionLoading: mockIsPermissionLoading(),
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
    <button type="button" aria-label="plugin debug" className={triggerClassName}>
      {triggerContent ?? 'debug'}
    </button>
  ),
}))

vi.mock('@/app/components/plugins/reference-setting-modal', () => ({
  __esModule: true,
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="reference-setting-modal">
      <button type="button" onClick={onHide}>
        close
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/update-setting-dialog', () => ({
  UpdateSettingDialog: () => (
    <button type="button" aria-label="plugin.autoUpdate.autoUpdate">
      plugin.autoUpdate.autoUpdate
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
  default: () => (
    <button type="button" aria-label="plugin tasks">
      tasks
    </button>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace-query', () => ({
  __esModule: true,
  default: ({ installContextCategory }: { installContextCategory?: string }) => (
    <div
      data-testid="install-from-marketplace-query"
      data-install-context-category={installContextCategory}
    />
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page', () => ({
  __esModule: true,
  default: ({
    layout,
    onOpenMarketplace,
    onSearchTextChange,
    searchText,
  }: {
    layout?: (parts: { body: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode
    onOpenMarketplace?: () => void
    onSearchTextChange?: (value: string) => void
    searchText: string
  }) => {
    const toolbar = (
      <div data-testid="model-provider-toolbar">
        <input
          aria-label="search"
          value={searchText}
          onChange={(event) => onSearchTextChange?.(event.target.value)}
        />
      </div>
    )
    const body = (
      <div data-testid="model-provider-page">
        <button type="button" aria-label="model provider marketplace" onClick={onOpenMarketplace}>
          marketplace
        </button>
      </div>
    )

    if (layout) return layout({ body, toolbar })

    return (
      <div data-testid="model-provider-page">
        <input
          aria-label="search"
          value={searchText}
          onChange={(event) => onSearchTextChange?.(event.target.value)}
        />
      </div>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/data-source-page-new', () => ({
  __esModule: true,
  default: ({
    layout,
    onOpenMarketplace,
  }: {
    layout?: (parts: { body: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode
    onOpenMarketplace?: () => void
  }) => {
    const toolbar = <div data-testid="data-source-toolbar" />
    const body = (
      <div data-testid="data-source-page">
        <button type="button" aria-label="data source marketplace" onClick={onOpenMarketplace}>
          marketplace
        </button>
      </div>
    )

    if (layout) return layout({ body, toolbar })

    return body
  },
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page', () => ({
  __esModule: true,
  ApiBasedExtensionPage: ({
    layout,
  }: {
    layout?: (parts: { body: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode
  }) => {
    const toolbar = <div data-testid="api-extension-toolbar" />
    const body = <div data-testid="api-extension-page" />

    if (layout) return layout({ body, toolbar })

    return body
  },
}))

vi.mock('../tool-provider-list', () => {
  const MockProviderList = ({
    category,
    layout,
  }: {
    category?: string
    layout?: (parts: { body: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode
  }) => {
    const toolbar = <div data-testid="tool-provider-toolbar" />
    const body = <div data-testid="tool-provider-list">{category}</div>

    if (layout) return layout({ body, toolbar })

    return body
  }

  return {
    __esModule: true,
    default: MockProviderList,
  }
})

vi.mock('../plugin-category-page', () => ({
  __esModule: true,
  default: ({
    canInstall,
    category,
    layout,
    onSwitchToMarketplace,
    toolbarAction,
  }: {
    canInstall?: boolean
    category: string
    layout?: (parts: { body: React.ReactNode; toolbar: React.ReactNode }) => React.ReactNode
    onSwitchToMarketplace?: () => void
    toolbarAction?: React.ReactNode
  }) => {
    const toolbar = <div data-testid="plugin-category-toolbar">{toolbarAction}</div>
    const body = (
      <div
        data-can-install={canInstall ? 'true' : 'false'}
        data-testid={`plugin-category-${category}`}
      >
        <button type="button" aria-label="empty marketplace" onClick={onSwitchToMarketplace}>
          marketplace
        </button>
      </div>
    )

    if (layout) return layout({ body, toolbar })

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
  sectionOrProps?:
    | React.ComponentProps<typeof IntegrationsPage>['section']
    | Partial<React.ComponentProps<typeof IntegrationsPage>>,
) => {
  const props = typeof sectionOrProps === 'string' ? { section: sectionOrProps } : sectionOrProps

  return renderWithNuqs(<IntegrationsPage {...props} />, { searchParams })
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.title = ''
    vi.stubGlobal('open', mockWindowOpen)
    mockCanManagement.mockReturnValue(true)
    mockCanDebugger.mockReturnValue(true)
    mockCanSetPermissions.mockReturnValue(true)
    mockIsPermissionLoading.mockReturnValue(false)
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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes compact navigation after switching sections in settings', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(width < 48rem)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const SettingsIntegrations = () => {
      const [section, setSection] =
        useState<React.ComponentProps<typeof IntegrationsPage>['section']>('provider')

      return <IntegrationsPage section={section} onSectionChange={setSection} />
    }
    renderWithNuqs(<SettingsIntegrations />)

    await user.click(
      screen.getByRole('button', {
        name: 'navigation.mainNav.integrations: navigation.settings.provider',
      }),
    )
    const navigationDrawer = await screen.findByRole('dialog', {
      name: 'navigation.mainNav.integrations',
    })
    await user.click(
      within(navigationDrawer).getByRole('button', {
        name: 'navigation.settings.dataSource',
      }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', {
          name: 'navigation.mainNav.integrations',
        }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
  })

  it('defaults to the model provider section when no query is provided', () => {
    renderIntegrationsPage()

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'navigation.settings.provider' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'navigation.settings.integrations' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('preserves model search while visiting another integration section', async () => {
    const user = userEvent.setup()
    const view = renderIntegrationsPage(undefined, 'provider')
    await user.type(screen.getByRole('textbox', { name: 'search' }), 'OpenAI')
    view.rerender(<IntegrationsPage section="data-source" />)
    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
    view.rerender(<IntegrationsPage section="provider" />)
    expect(screen.getByRole('textbox', { name: 'search' })).toHaveValue('OpenAI')
  })

  it('does not replace the document title when embedded in a modal', () => {
    document.title = 'Workspace settings - Dify'

    renderIntegrationsPage(undefined, 'provider')

    expect(document.title).toBe('Workspace settings - Dify')
  })

  it('reconciles the route title with client branding', () => {
    renderIntegrationsPage(undefined, { section: 'provider', syncDocumentTitle: true })

    expect(document.title).toBe(
      'navigation.settings.provider · navigation.mainNav.integrations - Dify',
    )
  })

  it('renders the model provider section from the section query', () => {
    renderIntegrationsPage({ section: 'provider' })

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace-query')).toHaveAttribute(
      'data-install-context-category',
      'model',
    )
    expect(
      screen.getByTestId('model-provider-toolbar').closest('[class*="max-w-[1600px]"]'),
    ).toHaveClass('px-6', 'pt-3', 'pb-2')
    expect(
      within(screen.getByTestId('model-provider-toolbar').closest('section')!).getByText(
        'navigation.settings.provider',
      ),
    ).toHaveClass('title-2xl-semi-bold')
    expect(
      screen.getByRole('heading', { level: 1, name: 'navigation.settings.provider' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'navigation.settings.provider' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByRole('link', { name: 'navigation.settings.dataSource' }),
    ).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('textbox', { name: 'search' })).toBeInTheDocument()
  })

  it('anchors step-by-step tour targets inside stable sidebar rows', () => {
    renderIntegrationsPage({ section: 'mcp' })

    const targetRows = [
      {
        label: 'navigation.settings.provider',
        target: STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      },
      {
        label: 'navigation.toolsPage.toolPlugin',
        target: STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      },
      {
        label: 'MCP',
        target: STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      },
      {
        label: 'navigation.settings.dataSource',
        target: STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      },
      {
        label: 'plugin.categorySingle.trigger',
        target: STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
      },
    ]

    targetRows.forEach(({ label, target }) => {
      const row = screen.getByRole('link', { name: label })
      const targetAnchor = row.querySelector<HTMLElement>(
        `[data-step-by-step-tour-target="${target}"]`,
      )

      expect(targetAnchor).toBeInTheDocument()
      expect(row).toContainElement(targetAnchor)
    })
  })

  it('renders plugin category sections from the section query', () => {
    const toolView = renderIntegrationsPage({ section: 'builtin' })

    expect(screen.getByTestId('plugin-category-tool')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'navigation.toolsPage.toolPlugin' })).toHaveAttribute(
      'href',
      '/integrations/tools/built-in',
    )

    toolView.unmount()
    const triggerView = renderIntegrationsPage({ section: 'trigger' })

    expect(screen.getByTestId('plugin-category-trigger')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.trigger' })).toHaveAttribute(
      'href',
      '/integrations/trigger',
    )

    triggerView.unmount()
    const agentStrategyView = renderIntegrationsPage({ section: 'agent-strategy' })

    expect(screen.getByTestId('plugin-category-agent-strategy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.agent' })).toHaveAttribute(
      'href',
      '/integrations/agent-strategy',
    )

    agentStrategyView.unmount()
    renderIntegrationsPage({ section: 'extension' })

    expect(screen.getByTestId('plugin-category-extension')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'plugin.categorySingle.extension' })).toHaveAttribute(
      'href',
      '/integrations/extension',
    )
  })

  it.each([
    ['provider', 'model provider marketplace', '/plugins/model'],
    ['data-source', 'data source marketplace', '/plugins/datasource'],
    ['extension', 'empty marketplace', '/plugins/extension'],
  ] as const)(
    'opens the %s marketplace path from integrations',
    async (section, buttonName, marketplacePath) => {
      const user = userEvent.setup()
      renderIntegrationsPage({ section })

      await user.click(screen.getByRole('button', { name: buttonName }))

      expect(mockWindowOpen).toHaveBeenCalledWith(
        expect.stringContaining(`${marketplacePath}?source=`),
        '_blank',
        'noopener,noreferrer',
      )
      expect(mockRouterPush).not.toHaveBeenCalled()
    },
  )

  it('passes marketplace platform paths to external marketplace callbacks', async () => {
    const user = userEvent.setup()
    const onSwitchToMarketplace = vi.fn()
    renderIntegrationsPage({ section: 'trigger' }, { onSwitchToMarketplace })

    await user.click(screen.getByRole('button', { name: 'empty marketplace' }))

    expect(onSwitchToMarketplace).toHaveBeenCalledWith('/plugins/trigger')
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('renders migrated legacy setting sections', () => {
    const { unmount } = renderIntegrationsPage({ section: 'data-source' })

    expect(screen.getByTestId('data-source-page')).toBeInTheDocument()
    expect(screen.getByTestId('install-from-marketplace-query')).toHaveAttribute(
      'data-install-context-category',
      'datasource',
    )
    expect(screen.getByRole('button', { name: 'plugin debug' })).toHaveTextContent(
      'plugin.debugInfo.title',
    )

    unmount()
    renderIntegrationsPage({ section: 'custom-endpoint' })

    expect(screen.getByTestId('api-extension-page')).toBeInTheDocument()
    expect(screen.queryByText('plugin.autoUpdate.autoUpdate')).not.toBeInTheDocument()
  })

  it('hides the plugin debug action when debug permission is unavailable', () => {
    mockCanDebugger.mockReturnValue(false)

    renderIntegrationsPage({ section: 'data-source' })

    expect(
      screen.queryByLabelText('plugin.privilege.noDebugPermissionTooltip'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin debug' })).not.toBeInTheDocument()
  })

  it('keeps existing category-only tools URLs functional', () => {
    renderIntegrationsPage({ category: 'mcp' })

    expect(screen.getByTestId('tool-provider-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'navigation.menus.tools' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: 'navigation.toolsPage.toolPlugin' })).toHaveAttribute(
      'href',
      '/integrations/tools/built-in',
    )
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute(
      'href',
      '/integrations/tools/mcp',
    )
    expect(screen.getByRole('link', { name: 'MCP' })).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('link', { name: 'navigation.settings.swaggerAPIAsTool' }),
    ).toHaveAttribute('href', '/integrations/tools/api')
    expect(screen.getByRole('link', { name: 'navigation.common.workflowAsTool' })).toHaveAttribute(
      'href',
      '/integrations/tools/workflow',
    )
  })

  it('toggles the tools submenu from the keyboard without other nav items closing it', async () => {
    const user = userEvent.setup()
    const onSectionChange = vi.fn()
    renderWithNuqs(<IntegrationsPage section="provider" onSectionChange={onSectionChange} />)

    const toolsButton = screen.getByRole('button', { name: 'navigation.menus.tools' })

    expect(toolsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()

    toolsButton.focus()
    await user.keyboard('{Enter}')

    expect(onSectionChange).toHaveBeenCalledWith('builtin')
    expect(toolsButton).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'navigation.toolsPage.toolPlugin' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'navigation.settings.provider' }))

    expect(onSectionChange).toHaveBeenCalledWith('provider')
    expect(toolsButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'MCP' })).toBeInTheDocument()

    toolsButton.focus()
    await user.keyboard(' ')

    expect(toolsButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
    expect(onSectionChange).toHaveBeenCalledTimes(2)
  })

  it('opens tools to the tools plugin page when the parent tools nav is clicked', async () => {
    const user = userEvent.setup()
    renderIntegrationsPage(undefined, 'provider')

    await user.click(screen.getByRole('button', { name: 'navigation.menus.tools' }))

    expect(mockRouterPush).toHaveBeenCalledWith('/integrations/tools/built-in')
  })

  it('keeps the tools disclosure independent from route section changes', async () => {
    const user = userEvent.setup()
    const view = renderIntegrationsPage(undefined, 'mcp')

    expect(screen.getByTestId('tool-provider-list')).toHaveTextContent('mcp')
    expect(screen.getByRole('button', { name: 'navigation.menus.tools' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('link', { name: 'navigation.toolsPage.toolPlugin' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MCP' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'navigation.menus.tools' }))

    expect(screen.getByTestId('tool-provider-list')).toHaveTextContent('mcp')
    expect(screen.getByRole('button', { name: 'navigation.menus.tools' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: 'navigation.toolsPage.toolPlugin' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument()

    view.rerender(<IntegrationsPage section="provider" />)

    expect(screen.getByTestId('model-provider-page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'navigation.menus.tools' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(
      screen.queryByRole('link', { name: 'navigation.toolsPage.toolPlugin' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MCP' })).not.toBeInTheDocument()

    view.rerender(<IntegrationsPage section="mcp" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'navigation.menus.tools' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })
  })

  it('renders the tools header for tool sections', () => {
    renderIntegrationsPage({ section: 'builtin' })

    expect(screen.getAllByText('navigation.toolsPage.toolPlugin')).toHaveLength(2)
    expect(screen.getByText('navigation.toolsPage.description')).toBeInTheDocument()
    expect(
      screen.getByText('navigation.toolsPage.description').closest('[class*="max-w-[1600px]"]'),
    ).toHaveClass('px-6')
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/tools')
  })

  it('renders the mcp header for the mcp section', () => {
    renderIntegrationsPage({ section: 'mcp' })

    expect(screen.getAllByText('MCP')).toHaveLength(2)
    expect(screen.getByText('common.mcpPage.description')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/tools#mcp')
    expect(screen.queryByText('navigation.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the custom tool header for the custom tool section', () => {
    renderIntegrationsPage({ section: 'custom-tool' })

    expect(screen.getAllByText('navigation.settings.swaggerAPIAsTool')).toHaveLength(2)
    expect(screen.getByText('common.swaggerAPIAsToolPage.description')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/self-host/use-dify/workspace/tools#swagger-api',
    )
    expect(screen.queryByText('navigation.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each([
    [
      'data-source',
      'navigation.settings.dataSource',
      'common.dataSourcePage.description',
      'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/datasource-plugin#data-source-plugin-types',
    ],
  ] as const)('renders the %s header with a docs link', (section, title, description, href) => {
    renderIntegrationsPage({ section })

    expect(screen.getAllByText(title)).toHaveLength(2)
    expect(screen.getByText(description)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute('href', href)
    expect(screen.queryByText('navigation.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the custom endpoint header with toolbar and docs link', () => {
    renderIntegrationsPage({ section: 'custom-endpoint' })

    expect(screen.getAllByText('navigation.settings.customEndpoint')).toHaveLength(2)
    expect(screen.getByText('common.apiBasedExtensionPage.description')).toBeInTheDocument()
    expect(screen.getByTestId('api-extension-toolbar')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/endpoint',
    )
    expect(screen.queryByText('navigation.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each([
    [
      'trigger',
      'plugin.categorySingle.trigger',
      'common.triggerPage.description',
      'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/trigger-plugin',
    ],
    [
      'extension',
      'plugin.categorySingle.extension',
      'common.extensionPage.description',
      'https://docs.dify.ai/en/self-host/use-dify/workspace/api-extension/api-extension',
    ],
    [
      'agent-strategy',
      'plugin.categorySingle.agent',
      'common.agentStrategyPage.description',
      'https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/agent-strategy-plugin',
    ],
  ] as const)('renders the %s header with a docs link', (section, title, description, href) => {
    renderIntegrationsPage({ section })

    expect(screen.getAllByText(title)).toHaveLength(2)
    expect(screen.getByText(description)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute('href', href)
    expect(screen.queryByText('navigation.toolsPage.description')).not.toBeInTheDocument()
  })

  it('renders the workflow as tool header with a docs link', () => {
    renderIntegrationsPage({ section: 'workflow-tool' })

    expect(screen.getAllByText('navigation.common.workflowAsTool')).toHaveLength(2)
    expect(screen.getByText('common.workflowAsToolPage.description')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /modelProvider\.modelProvider\.learnMore/i }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/en/self-host/use-dify/workspace/tools#workflow')
    expect(screen.queryByText('navigation.toolsPage.description')).not.toBeInTheDocument()
  })

  it.each(['builtin', 'trigger', 'extension', 'agent-strategy'] as const)(
    'renders plugin update settings action in the category toolbar for %s',
    (section) => {
      renderIntegrationsPage({ section })

      expect(
        screen.getByRole('button', { name: 'plugin.autoUpdate.autoUpdate' }),
      ).toBeInTheDocument()
    },
  )

  it('opens the integrations marketplace path from the install dropdown marketplace action', async () => {
    const user = userEvent.setup()
    renderIntegrationsPage({ section: 'builtin' })

    await user.click(screen.getByRole('button', { name: 'plugin install' }))

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

    expect(
      screen.queryByLabelText('plugin.privilege.noInstallPermissionTooltip'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin install' })).not.toBeInTheDocument()
    expect(screen.getByTestId('plugin-category-trigger')).toHaveAttribute(
      'data-can-install',
      'false',
    )
  })

  it('hides the debug action when debug permission is unavailable', () => {
    mockCanDebugger.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(
      screen.queryByLabelText('plugin.privilege.noDebugPermissionTooltip'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin debug' })).not.toBeInTheDocument()
  })

  it('hides plugin update settings action when permission management is unavailable', () => {
    mockCanSetPermissions.mockReturnValue(false)

    renderIntegrationsPage({ section: 'trigger' })

    expect(
      screen.queryByRole('button', { name: 'plugin.autoUpdate.autoUpdate' }),
    ).not.toBeInTheDocument()
  })

  it('opens the sidebar plugin permissions quick settings and updates permissions', async () => {
    const user = userEvent.setup()
    renderIntegrationsPage({ section: 'provider' })

    await user.click(screen.getByRole('button', { name: 'plugin.privilege.permissions' }))

    const dialog = screen.getByRole('dialog', { name: 'plugin.privilege.permissions' })
    expect(within(dialog).getByText('plugin.privilege.quickWhoCanInstall')).toBeInTheDocument()
    expect(within(dialog).getByText('plugin.privilege.quickWhoCanDebug')).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('radio', {
        name: 'plugin.privilege.quickWhoCanInstall: plugin.privilege.noone',
      }),
    )

    expect(mockSetReferenceSettings).toHaveBeenCalledWith({
      install_permission: 'noone',
      debug_permission: 'admins',
    })

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

    expect(
      screen.queryByRole('dialog', { name: 'plugin.privilege.permissions' }),
    ).not.toBeInTheDocument()
  })

  it('hides the sidebar plugin permissions quick settings when permission management is unavailable', () => {
    mockCanSetPermissions.mockReturnValue(false)
    renderIntegrationsPage({ section: 'provider' })

    expect(
      screen.queryByRole('button', { name: 'plugin.privilege.permissions' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.privilege.quickWhoCanInstall')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.privilege.quickWhoCanDebug')).not.toBeInTheDocument()
  })
})
