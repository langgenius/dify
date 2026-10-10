import type { ReactNode } from 'react'
import type { Credential } from '../types'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import PluginAuth from '../plugin-auth'
import { AuthCategory, CredentialTypeEnum } from '../types'

const mockUsePluginAuth = vi.fn()
const mockSetSettingsDestination = vi.fn()
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'] as string[],
}))

vi.mock('../hooks/use-plugin-auth', () => ({
  usePluginAuth: (...args: unknown[]) => mockUsePluginAuth(...args),
}))

vi.mock('../authorized', () => ({
  default: ({
    pluginPayload,
    renderTrigger,
  }: {
    pluginPayload: { provider: string }
    renderTrigger?: (open?: boolean) => ReactNode
  }) =>
    renderTrigger ? (
      renderTrigger(false)
    ) : (
      <div data-testid="authorized">
        Authorized:
        {pluginPayload.provider}
      </div>
    ),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return { ...actual, useQueryState: () => [null, mockSetSettingsDestination] }
})

const defaultPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: '1',
  name: 'key',
  is_default: true,
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  credentials: { api_key: 'sk********1234' },
  ...overrides,
})

const createConnectionQueryWrapper = () => {
  const { queryClient, wrapper } = createConsoleQueryWrapper()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
      {
        input: {
          params: {
            provider: defaultPayload.provider,
            credential_type: CredentialTypeEnum.API_KEY,
          },
        },
      },
    ),
    [{ name: 'api_key', type: 'secret-input', required: true, multiple: false }],
  )
  return wrapper
}

describe('PluginAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState.workspacePermissionKeys = [
      'credential.use',
      'credential.create',
      'credential.manage',
    ]
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Authorize component when not authorized', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeEnabled()
    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()
  })

  it('renders Authorized component when authorized without node auth configuration', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: true,
      canApiKey: true,
      credentials: [createCredential()],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(screen.getByTestId('authorized')).toBeInTheDocument()
    expect(screen.queryByTestId('authorize')).not.toBeInTheDocument()
  })

  it('switches from authorization controls to the node selector when credentials become available', () => {
    const onAuthorizationItemClick = vi.fn()
    const authorization = {
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    }
    mockUsePluginAuth.mockReturnValue(authorization)
    const { rerender } = render(
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick }}
        authorizedFooter={<button type="button">Workflow settings</button>}
        showAuthorizationTabs
      />,
      { wrapper: createConnectionQueryWrapper() },
    )

    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Workspace API key/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Workflow settings' })).not.toBeInTheDocument()

    mockUsePluginAuth.mockReturnValue({
      ...authorization,
      isAuthorized: true,
      credentials: [
        createCredential({ name: 'Workspace API key' }),
        createCredential({
          id: '2',
          name: 'Selected API key',
          is_default: false,
          credentials: { api_key: 'sk********5678' },
        }),
      ],
    })
    rerender(
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick }}
        authorizedFooter={<button type="button">Workflow settings</button>}
        showAuthorizationTabs
      />,
    )

    expect(screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
    const defaultConnection = screen.getByRole('button', { name: /Workspace API key/ })
    expect(defaultConnection).toBeVisible()
    expect(defaultConnection).toHaveTextContent('•••• 1234')
    expect(screen.queryByRole('button', { name: /Selected API key/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Workflow settings' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'plugin.auth.authorization' })).toBeVisible()

    rerender(
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick, credentialId: '2' }}
        showAuthorizationTabs
      />,
    )

    const selectedConnection = screen.getByRole('button', { name: /Selected API key/ })
    expect(selectedConnection).toBeVisible()
    expect(selectedConnection).toHaveTextContent('•••• 5678')
    expect(mockUsePluginAuth).toHaveBeenLastCalledWith(defaultPayload, true, ['2'])
    expect(screen.queryByRole('button', { name: /Workspace API key/ })).not.toBeInTheDocument()
  })

  it('keeps authorization tabs visible for authorized nodes and independent from the workflow tabs', async () => {
    const user = userEvent.setup()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: false,
      canApiKey: true,
      credentials: [createCredential()],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(
      <Tabs defaultValue="settings">
        <PluginAuth
          pluginPayload={defaultPayload}
          nodeAuth={{ onAuthorizationItemClick: vi.fn() }}
          showAuthorizationTabs
          authorizedFooter={
            <TabsList>
              <TabsTab value="settings">Settings</TabsTab>
              <TabsTab value="last-run">Last run</TabsTab>
            </TabsList>
          }
        />
        <TabsPanel value="settings">Settings content</TabsPanel>
        <TabsPanel value="last-run">Last run content</TabsPanel>
      </Tabs>,
      { wrapper: createConnectionQueryWrapper() },
    )

    expect(screen.getByRole('heading', { name: 'plugin.auth.authorization' })).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toHaveTextContent('Settings content')
    const workspaceTab = screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' })
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    const reuseTab = screen.getByRole('tab', { name: 'plugin.auth.reuseFromNode' })
    const workspacePanel = screen.getByRole('tabpanel', { name: 'plugin.auth.workspaceAuth' })
    expect(workspaceTab).toHaveAttribute('aria-selected', 'true')
    expect(within(workspacePanel).getByRole('button', { name: /key/ })).toBeVisible()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()

    await user.click(appUserTab)

    expect(screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /key/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Last run' }))

    expect(screen.getByRole('tab', { name: 'Last run' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Last run' })).toHaveTextContent('Last run content')
    expect(screen.queryByRole('tabpanel', { name: 'Settings' })).not.toBeInTheDocument()
    expect(appUserTab).toHaveAttribute('aria-selected', 'true')

    await user.click(reuseTab)

    expect(
      screen.getByRole('tabpanel', { name: 'plugin.auth.reuseFromNode' }),
    ).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /key/ })).not.toBeInTheDocument()
    expect(workspaceTab).toBeVisible()
    expect(appUserTab).toBeVisible()
    expect(reuseTab).toBeVisible()

    await user.click(workspaceTab)

    expect(
      within(screen.getByRole('tabpanel', { name: 'plugin.auth.workspaceAuth' })).getByRole(
        'button',
        {
          name: /key/,
        },
      ),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Last run' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'Settings' }))

    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toHaveTextContent('Settings content')
    expect(workspaceTab).toHaveAttribute('aria-selected', 'true')
  })

  it('shows workspace authorization controls only in the Workspace Auth tab', async () => {
    const user = userEvent.setup()
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} showAuthorizationTabs />)

    expect(screen.getByRole('heading', { name: 'plugin.auth.authorization' })).toBeVisible()
    const workspaceTab = screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' })
    expect(workspaceTab).toHaveAttribute('aria-selected', 'true')
    const workspacePanel = screen.getByRole('tabpanel', { name: 'plugin.auth.workspaceAuth' })
    expect(
      within(workspacePanel).getByRole('button', { name: 'plugin.auth.useApiAuth' }),
    ).toBeDisabled()
    expect(within(workspacePanel).getByText('plugin.auth.permissionHint.title')).toBeVisible()

    for (const label of ['plugin.auth.appUserAuth', 'plugin.auth.reuseFromNode']) {
      const tab = screen.getByRole('tab', { name: label })
      await user.click(tab)

      expect(tab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel', { name: label })).toBeEmptyDOMElement()
      expect(
        screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'plugin.auth.permissionHint.action' }),
      ).not.toBeInTheDocument()
    }

    await user.click(workspaceTab)

    const restoredWorkspacePanel = screen.getByRole('tabpanel', {
      name: 'plugin.auth.workspaceAuth',
    })
    expect(
      within(restoredWorkspacePanel).getByRole('button', { name: 'plugin.auth.useApiAuth' }),
    ).toBeDisabled()
    expect(
      within(restoredWorkspacePanel).getByText('plugin.auth.permissionHint.title'),
    ).toBeVisible()
  })

  it('passes pluginPayload.provider to usePluginAuth', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: false,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(mockUsePluginAuth).toHaveBeenCalledWith(defaultPayload, true, undefined)
  })

  it('renders permission hint and disables authorization configuration when credential.create is missing', () => {
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
    expect(screen.getByText('plugin.auth.permissionHint.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.permissionHint.description')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' }),
    ).toBeInTheDocument()
  })

  it('opens members settings when permission hint action is clicked', () => {
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    fireEvent.click(screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' }))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('members')
  })

  it('does not render permission hint for datasource authorization', () => {
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={{ ...defaultPayload, category: AuthCategory.datasource }} />)

    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  })

  it('does not render permission hint when custom credentials are unavailable', () => {
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: true,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  })
})
