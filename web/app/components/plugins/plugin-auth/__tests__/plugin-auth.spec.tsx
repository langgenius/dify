import type { ReactNode } from 'react'
import type { AppUserAuthDraft, AuthorizationTab } from '../app-user-auth/draft'
import type { Credential } from '../types'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
const mockConsoleCall = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (...args: unknown[]) => mockConsoleCall(...args),
  },
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
    mockConsoleCall.mockImplementation(async (path: string[]) => {
      if (path.includes('clientSchema')) {
        return {
          schema: [],
          is_oauth_custom_client_enabled: false,
          is_system_oauth_params_exists: true,
          client_params: {},
          redirect_uri: 'https://example.com/oauth/callback',
        }
      }
      return [{ name: 'api_key', type: 'secret-input', required: true, multiple: false }]
    })
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
        showAuthorizationTabs
      />,
      { wrapper: createConnectionQueryWrapper() },
    )

    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Workspace API key/ })).not.toBeInTheDocument()

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
        showAuthorizationTabs
      />,
    )

    expect(screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
    const defaultConnection = screen.getByRole('button', { name: /Workspace API key/ })
    expect(defaultConnection).toBeVisible()
    expect(defaultConnection).toHaveTextContent('•••• 1234')
    expect(screen.queryByRole('button', { name: /Selected API key/ })).not.toBeInTheDocument()
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

  it('keeps authorization tabs visible for authorized nodes', async () => {
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
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick: vi.fn() }}
        showAuthorizationTabs
      />,
      { wrapper: createConnectionQueryWrapper() },
    )

    expect(screen.getByRole('heading', { name: 'plugin.auth.authorization' })).toBeVisible()
    const workspaceTab = screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' })
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    const reuseTab = screen.getByRole('tab', { name: 'plugin.auth.reuseFromNode' })
    const workspacePanel = screen.getByRole('tabpanel', { name: 'plugin.auth.workspaceAuth' })
    expect(workspaceTab).toHaveAttribute('aria-selected', 'true')
    expect(within(workspacePanel).getByRole('button', { name: /key/ })).toBeVisible()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()

    await user.click(appUserTab)

    const appUserPanel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(
      within(appUserPanel).getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' }),
    ).toBeChecked()
    expect(
      within(appUserPanel).queryByRole('checkbox', { name: 'plugin.auth.appUser.oauth' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /key/ })).not.toBeInTheDocument()

    await user.click(reuseTab)

    expect(
      within(screen.getByRole('tabpanel', { name: 'plugin.auth.reuseFromNode' })).getByRole(
        'combobox',
        {
          name: 'plugin.auth.reuse.selectNode',
        },
      ),
    ).toBeDisabled()
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
      const panel = screen.getByRole('tabpanel', { name: label })
      if (label === 'plugin.auth.appUserAuth') {
        expect(
          within(panel).getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' }),
        ).toBeChecked()
      } else {
        expect(
          within(panel).getByRole('combobox', { name: 'plugin.auth.reuse.selectNode' }),
        ).toBeDisabled()
      }
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

  it('retains App user auth drafts across tabs and uses the provider capabilities and name', async () => {
    const user = userEvent.setup()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: true,
      canApiKey: false,
      credentials: [createCredential({ credential_type: CredentialTypeEnum.OAUTH2 })],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    render(
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick: vi.fn(), providerName: 'Google Drive' }}
        showAuthorizationTabs
      />,
      { wrapper: createConnectionQueryWrapper() },
    )
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    await user.click(appUserTab)
    let panel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(
      within(panel).queryByRole('checkbox', { name: 'plugin.auth.connection.apiKey' }),
    ).not.toBeInTheDocument()
    expect(within(panel).getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    expect(within(panel).getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.type(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
      'Choose a Drive connection',
    )
    expect(
      within(panel).queryByText('plugin.auth.appUser.enterDescription'),
    ).not.toBeInTheDocument()
    await user.click(
      within(panel).getByRole('button', { name: 'plugin.auth.appUser.configureClient' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.appUser.clientId' }),
      'drive-client',
    )
    await user.type(
      within(dialog).getByLabelText('plugin.auth.appUser.clientSecret', { exact: false }),
      'drive-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: 'plugin.auth.saveOnly' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(within(panel).queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    expect(
      within(panel).getByText(
        'plugin.auth.appUser.oauthDescriptionWithProvider:{"provider":"Google Drive"}',
      ),
    ).toBeVisible()
    await user.click(within(panel).getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' }))

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.reuseFromNode' }))
    await user.click(appUserTab)

    panel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
    ).toHaveValue('Choose a Drive connection')
    const oauth = within(panel).getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    expect(oauth).not.toBeChecked()
    await user.click(oauth)
    await user.click(
      within(panel).getByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    )

    const reopened = await screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    expect(
      within(reopened).getByRole('textbox', { name: 'plugin.auth.appUser.clientId' }),
    ).toHaveValue('drive-client')
    expect(
      within(reopened).getByLabelText('plugin.auth.appUser.clientSecret', { exact: false }),
    ).toHaveValue('drive-secret')
  })

  it('initializes a controlled App user auth draft from supported methods when first selected', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [createCredential()],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    const ControlledPluginAuth = () => {
      const [draft, setDraft] = useState<AppUserAuthDraft>()
      const [tab, setTab] = useState<AuthorizationTab>('workspace-auth')
      return (
        <PluginAuth
          pluginPayload={defaultPayload}
          showAuthorizationTabs
          authorizationTab={tab}
          onAuthorizationTabChange={setTab}
          appUserAuth={{
            draft,
            onChange: (nextDraft) => {
              setDraft(nextDraft)
              onDraftChange(nextDraft)
            },
          }}
        />
      )
    }
    render(<ControlledPluginAuth />)
    expect(onDraftChange).not.toHaveBeenCalled()
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    await user.click(appUserTab)

    expect(appUserTab).toHaveAttribute('aria-selected', 'true')
    expect(onDraftChange).toHaveBeenCalledExactlyOnceWith({
      oauthEnabled: false,
      apiKeyEnabled: true,
      description: '',
      client: undefined,
    })
    const panel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(
      within(panel).getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' }),
    ).toBeChecked()
    expect(
      within(panel).queryByRole('checkbox', { name: 'plugin.auth.appUser.oauth' }),
    ).not.toBeInTheDocument()
    expect(within(panel).getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    expect(within(panel).queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    await user.type(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
      'Keep this draft',
    )
    expect(
      within(panel).queryByText('plugin.auth.appUser.enterDescription'),
    ).not.toBeInTheDocument()
    const changeCount = onDraftChange.mock.calls.length
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    await user.click(appUserTab)

    expect(onDraftChange).toHaveBeenCalledTimes(changeCount)
    expect(
      within(screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })).getByRole(
        'textbox',
        {
          name: 'plugin.auth.appUser.connectionDescription',
        },
      ),
    ).toHaveValue('Keep this draft')
  })

  it('preserves and validates an existing controlled App user auth draft', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: true,
      canApiKey: true,
      credentials: [createCredential()],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    render(
      <PluginAuth
        pluginPayload={defaultPayload}
        showAuthorizationTabs
        appUserAuth={{
          draft: {
            oauthEnabled: false,
            apiKeyEnabled: false,
            description: 'Existing connection description',
          },
          onChange: onDraftChange,
        }}
      />,
    )
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    await user.click(appUserTab)

    expect(onDraftChange).not.toHaveBeenCalled()
    const panel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(
      within(panel).getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' }),
    ).not.toBeChecked()
    expect(
      within(panel).getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' }),
    ).not.toBeChecked()
    expect(within(panel).getByText('plugin.auth.appUser.selectMethod')).toBeVisible()
    expect(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
    ).toHaveValue('Existing connection description')

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.reuseFromNode' }))
    await user.click(appUserTab)

    expect(onDraftChange).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })).getByRole(
        'textbox',
        {
          name: 'plugin.auth.appUser.connectionDescription',
        },
      ),
    ).toHaveValue('Existing connection description')
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
