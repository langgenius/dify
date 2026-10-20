import type { BuiltinProviderOAuthClientSchemaResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { AppUserAuthDraft, AuthorizationTab } from '../app-user-auth/draft'
import type { Credential } from '../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithoutUrlState } from '@/test/console/render'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import PluginAuth from '../plugin-auth'
import { AuthCategory, CredentialTypeEnum } from '../types'

const mockUsePluginAuth = vi.fn()
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'] as string[],
}))
const mockConsoleCall = vi.hoisted(() => vi.fn())
const mockOAuthClientMutations = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (...args: unknown[]) => mockConsoleCall(...args),
  },
}))

vi.mock('../hooks/use-plugin-auth', () => ({
  usePluginAuth: (...args: unknown[]) => mockUsePluginAuth(...args),
}))

vi.mock('../hooks/use-credential', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-credential')>()
  return {
    ...actual,
    useSetPluginOAuthCustomClientHook: () => ({ mutateAsync: mockOAuthClientMutations.save }),
    useDeletePluginOAuthCustomClientHook: () => ({ mutateAsync: mockOAuthClientMutations.remove }),
  }
})

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

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

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
    mockOAuthClientMutations.save.mockResolvedValue({ result: 'success' })
    mockOAuthClientMutations.remove.mockResolvedValue({ result: 'success' })
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
    expect(mockUsePluginAuth).toHaveBeenCalledWith(defaultPayload, true, undefined)
    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeEnabled()
    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()
  })

  it('offers a retry instead of treating a failed connection request as an empty list', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onAuthorizationItemClick = vi.fn()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: false,
      credentials: [],
      loadError: { onRetry },
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    render(<PluginAuth pluginPayload={defaultPayload} nodeAuth={{ onAuthorizationItemClick }} />, {
      wrapper: createConnectionQueryWrapper(),
    })

    await user.click(screen.getByRole('button', { name: /^plugin.auth.workspaceDefault/ }))
    expect(screen.getByRole('status')).toHaveTextContent('plugin.auth.connection.loadError')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onAuthorizationItemClick).not.toHaveBeenCalled()
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
    expect(screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
  })

  it('requests provider schemas only after entering App user from Reuse', async () => {
    const user = userEvent.setup()
    const pluginPayload = { ...defaultPayload, provider: 'drive-provider' }
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: true,
      canApiKey: true,
      credentials: [createCredential({ provider: pluginPayload.provider })],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    const ControlledPluginAuth = () => {
      const [tab, setTab] = useState<AuthorizationTab>('reuse-from-node')
      return (
        <PluginAuth
          pluginPayload={pluginPayload}
          nodeAuth={{ onAuthorizationItemClick: vi.fn() }}
          authorizationTab={tab}
          onAuthorizationTabChange={setTab}
          showAuthorizationTabs
        />
      )
    }
    render(<ControlledPluginAuth />, { wrapper: createConsoleQueryWrapper().wrapper })
    expect(screen.getByRole('tabpanel', { name: 'plugin.auth.reuseFromNode' })).toBeVisible()
    const schemaRequests = () =>
      mockConsoleCall.mock.calls.filter(
        ([path]) =>
          path.includes('clientSchema') || (path.includes('credential') && path.includes('schema')),
      )
    expect(schemaRequests()).toEqual([])

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' }))

    expect(screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })).toBeVisible()
    await waitFor(() =>
      expect(
        schemaRequests().map(([path, input]) => ({ endpoint: path.slice(-3).join('.'), input })),
      ).toEqual(
        expect.arrayContaining([
          {
            endpoint: 'oauth.clientSchema.get',
            input: { params: { provider: pluginPayload.provider } },
          },
          {
            endpoint: 'schema.byCredentialType.get',
            input: {
              params: {
                provider: pluginPayload.provider,
                credential_type: CredentialTypeEnum.API_KEY,
              },
            },
          },
        ]),
      ),
    )
  })

  it('keeps mock test connections independent when Workspace authorization becomes available', async () => {
    const user = userEvent.setup()
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
        nodeAuth={{ onAuthorizationItemClick, credentialId: '2' }}
        showAuthorizationTabs
      />,
      { wrapper: createConnectionQueryWrapper() },
    )
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' }))
    const testConnection = within(
      screen.getByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
    )
    const mockConnection = testConnection.getByRole('button', {
      name: /^API key test connection/,
    })
    expect(mockConnection).toBeVisible()
    expect(mockConnection).toHaveTextContent('•••• 7A2F')
    expect(
      testConnection.getByText('plugin.auth.appUser.testConnectionApiKeyDescription'),
    ).toBeVisible()
    expect(
      testConnection.queryByRole('button', { name: 'plugin.auth.common.addApiKey' }),
    ).not.toBeInTheDocument()

    mockUsePluginAuth.mockReturnValue({
      ...authorization,
      isAuthorized: true,
      credentials: [
        createCredential({ name: 'Workspace API key' }),
        createCredential({ id: '2', name: 'Selected API key', is_default: false }),
      ],
    })
    rerender(
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick, credentialId: '2' }}
        showAuthorizationTabs
      />,
    )
    expect(
      testConnection.getByRole('button', {
        name: /^API key test connection/,
      }),
    ).toBeVisible()
    expect(
      testConnection.queryByRole('button', { name: /Selected API key/ }),
    ).not.toBeInTheDocument()
    expect(onAuthorizationItemClick).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    expect(screen.getByRole('button', { name: /Selected API key/ })).toBeVisible()
    expect(mockUsePluginAuth).toHaveBeenLastCalledWith(defaultPayload, true, ['2'])
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
    expect(within(appUserPanel).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      within(appUserPanel).getByRole('heading', { name: 'plugin.auth.appUser.userAuthentication' }),
    ).toBeVisible()
    expect(
      within(appUserPanel).getByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
    ).toBeVisible()
    expect(
      within(appUserPanel).getByRole('button', {
        name: /^API key test connection/,
      }),
    ).toBeVisible()

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

  it('applies Workspace creation permission without restricting mock test connections or exposing controls in Reuse', async () => {
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

    render(<PluginAuth pluginPayload={defaultPayload} showAuthorizationTabs />, {
      wrapper: createConnectionQueryWrapper(),
    })

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
        expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
        expect(
          within(panel).getByRole('heading', { name: 'plugin.auth.appUser.userAuthentication' }),
        ).toBeVisible()
        const testConnection = within(
          within(panel).getByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
        )
        expect(
          testConnection.getByRole('button', {
            name: /^API key test connection/,
          }),
        ).toBeEnabled()
        expect(
          testConnection.queryByRole('button', { name: 'plugin.auth.common.addApiKey' }),
        ).not.toBeInTheDocument()
        expect(
          testConnection.queryByText('plugin.auth.permissionHint.title'),
        ).not.toBeInTheDocument()
      } else {
        expect(
          within(panel).getByRole('combobox', { name: 'plugin.auth.reuse.selectNode' }),
        ).toBeDisabled()
        expect(
          screen.queryByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'plugin.auth.common.addApiKey' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' }),
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'plugin.auth.permissionHint.action' }),
        ).not.toBeInTheDocument()
      }
    }

    await user.click(workspaceTab)

    const restoredWorkspacePanel = screen.getByRole('tabpanel', {
      name: 'plugin.auth.workspaceAuth',
    })
    expect(
      within(restoredWorkspacePanel).getByRole('button', {
        name: 'plugin.auth.useApiAuth',
      }),
    ).toBeDisabled()
    expect(
      within(restoredWorkspacePanel).getByText('plugin.auth.permissionHint.title'),
    ).toBeVisible()
  })

  it('selects mock test connections without changing Workspace selection or losing App user drafts', async () => {
    const user = userEvent.setup()
    const onAuthorizationItemClick = vi.fn()
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: true,
      canApiKey: true,
      credentials: [
        createCredential({ name: 'Workspace connection' }),
        createCredential({ id: '2', name: 'Personal connection', is_default: false }),
      ],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    const AppUserDraftHarness = () => {
      const [draft, setDraft] = useState<AppUserAuthDraft>()
      return (
        <PluginAuth
          pluginPayload={defaultPayload}
          nodeAuth={{ credentialId: '2', onAuthorizationItemClick }}
          appUserAuth={{ draft, onChange: setDraft }}
          showAuthorizationTabs
        />
      )
    }
    render(<AppUserDraftHarness />, { wrapper: createConnectionQueryWrapper() })
    expect(screen.getByRole('button', { name: /^Personal connection/ })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' }))
    const appUserPanel = within(screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' }))
    const description = appUserPanel.getByRole('textbox', {
      name: 'plugin.auth.appUser.connectionDescription',
    })
    await user.type(description, 'Choose a connection for app users')
    const apiKey = appUserPanel.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    await user.click(apiKey)
    const testConnection = within(
      appUserPanel.getByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
    )
    const oauth = testConnection.getByRole('button', {
      name: /^OAuth test connection/,
    })
    expect(oauth).toHaveTextContent('@test-user')
    await user.click(oauth)
    const picker = await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })
    expect(
      within(picker).queryByRole('button', { name: /plugin\.auth\.workspaceDefault/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Personal connection/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Workspace connection/ })).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole('button', {
        name: /^API key test connection/,
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', {
          name: 'plugin.auth.authorization',
        }),
      ).not.toBeInTheDocument(),
    )

    expect(onAuthorizationItemClick).not.toHaveBeenCalled()
    expect(
      testConnection.getByRole('button', {
        name: /^API key test connection/,
      }),
    ).toBeVisible()
    expect(description).toHaveValue('Choose a connection for app users')
    expect(apiKey).not.toBeChecked()

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    expect(screen.getByRole('button', { name: /^Personal connection/ })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' }))
    expect(
      testConnection.getByRole('button', {
        name: /^API key test connection/,
      }),
    ).toBeVisible()
    expect(description).toHaveValue('Choose a connection for app users')
    expect(apiKey).not.toBeChecked()
    expect(onAuthorizationItemClick).not.toHaveBeenCalled()
    expect(
      mockConsoleCall.mock.calls.filter(([path]) => Array.isArray(path) && path.at(-1) === 'post'),
    ).toEqual([])
  })

  it('allows mock connection selection without Workspace permissions while Workspace rows stay disabled', async () => {
    const user = userEvent.setup()
    const onAuthorizationItemClick = vi.fn()
    mockConsoleState.workspacePermissionKeys = []
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: true,
      canApiKey: true,
      credentials: [createCredential({ name: 'Workspace connection' })],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    render(
      <PluginAuth
        pluginPayload={defaultPayload}
        nodeAuth={{ onAuthorizationItemClick }}
        showAuthorizationTabs
      />,
      { wrapper: createConnectionQueryWrapper() },
    )
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' }))
    const testConnection = within(
      screen.getByRole('region', { name: 'plugin.auth.appUser.testConnection' }),
    )
    await user.click(
      testConnection.getByRole('button', {
        name: /^OAuth test connection/,
      }),
    )
    const mockConnection = await screen.findByRole('button', {
      name: /^API key test connection/,
    })
    expect(mockConnection).toBeEnabled()
    await user.click(mockConnection)
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', {
          name: 'plugin.auth.authorization',
        }),
      ).not.toBeInTheDocument(),
    )
    expect(
      testConnection.getByRole('button', {
        name: /^API key test connection/,
      }),
    ).toBeVisible()
    expect(onAuthorizationItemClick).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    await user.click(screen.getByRole('button', { name: /^Workspace connection/ }))
    const connection = within(
      screen.getByRole('group', { name: 'common.userProfile.workspace' }),
    ).getByRole('button', { name: /^Workspace connection/ })
    expect(connection).toBeDisabled()
    await user.click(connection)
    expect(onAuthorizationItemClick).not.toHaveBeenCalled()
  })

  it('shares saved and removed OAuth client settings with Workspace while retaining App user drafts', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    let oauthClient: BuiltinProviderOAuthClientSchemaResponse = {
      schema: [
        {
          name: 'client_id',
          label: { en_US: 'Client ID' },
          type: 'text-input',
          required: true,
        },
        {
          name: 'client_secret',
          label: { en_US: 'Client Secret' },
          type: 'secret-input',
          required: true,
        },
      ],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
      client_params: {},
      redirect_uri: 'https://example.com/oauth/callback',
    }
    mockConsoleCall.mockImplementation(async (path: string[]) => {
      if (path.includes('clientSchema')) return structuredClone(oauthClient)
      return []
    })
    mockOAuthClientMutations.save.mockImplementation(async () => {
      oauthClient = {
        ...oauthClient,
        is_oauth_custom_client_enabled: true,
        client_params: { client_id: 'drive-client', client_secret: '[__HIDDEN__]' },
      }
      return { result: 'success' }
    })
    mockOAuthClientMutations.remove.mockImplementation(async () => {
      oauthClient = {
        ...oauthClient,
        is_oauth_custom_client_enabled: false,
        client_params: {},
      }
      return { result: 'success' }
    })
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      isLoading: false,
      canOAuth: true,
      canApiKey: false,
      credentials: [
        createCredential({
          name: 'Workspace Drive connection',
          credential_type: CredentialTypeEnum.OAUTH2,
        }),
      ],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })
    const AppUserDraftHarness = () => {
      const [draft, setDraft] = useState<AppUserAuthDraft>()
      return (
        <PluginAuth
          pluginPayload={defaultPayload}
          nodeAuth={{ onAuthorizationItemClick: vi.fn(), providerName: 'Google Drive' }}
          appUserAuth={{
            draft,
            onChange: (nextDraft) => {
              setDraft(nextDraft)
              onDraftChange(nextDraft)
            },
          }}
          showAuthorizationTabs
        />
      )
    }
    render(<AppUserDraftHarness />, { wrapper: createConnectionQueryWrapper() })
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    await user.click(appUserTab)
    let panel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: 'plugin.auth.oauthClient' })).toBeVisible()
    expect(within(panel).queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    const configureClient = within(panel).getByRole('button', {
      name: 'plugin.auth.common.configureClient',
    })
    expect(configureClient).not.toHaveAccessibleDescription()
    expect(within(panel).getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.type(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
      'Choose a Drive connection',
    )
    expect(
      within(panel).queryByText('plugin.auth.appUser.enterDescription'),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(configureClient).toBeEnabled())
    await user.click(configureClient)
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    expect(within(dialog).getByText('https://example.com/oauth/callback')).toBeVisible()
    await user.type(within(dialog).getByRole('textbox', { name: 'Client ID' }), 'drive-client')
    await user.type(
      within(dialog).getByLabelText('Client Secret', { exact: false }),
      'drive-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: 'plugin.auth.saveOnly' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(mockOAuthClientMutations.save).toHaveBeenCalledExactlyOnceWith({
      client_params: { client_id: 'drive-client', client_secret: 'drive-secret' },
      enable_oauth_custom_client: true,
    })
    expect(
      await within(panel).findByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    ).toBeVisible()
    expect(within(panel).queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    expect(within(panel).getByText('plugin.auth.appUser.oauthClientDescription')).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    const openWorkspaceClientSettings = async () => {
      const workspacePanel = screen.getByRole('tabpanel', { name: 'plugin.auth.workspaceAuth' })
      await user.click(
        within(workspacePanel).getByRole('button', { name: /^Workspace Drive connection/ }),
      )
      const settings = await screen.findByRole('button', {
        name: 'plugin.auth.connection.oauthClientSettings',
      })
      await waitFor(() => expect(settings).toBeEnabled())
      await user.click(settings)
      return screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    }
    const workspaceSettings = await openWorkspaceClientSettings()
    expect(within(workspaceSettings).getByRole('textbox', { name: 'Client ID' })).toHaveValue(
      'drive-client',
    )
    expect(within(workspaceSettings).getByLabelText('Client Secret', { exact: false })).toHaveValue(
      '[__HIDDEN__]',
    )
    await user.click(
      within(workspaceSettings).getByRole('button', { name: 'common.operation.cancel' }),
    )
    await waitFor(() => expect(workspaceSettings).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: 'plugin.auth.reuseFromNode' }))
    await user.click(appUserTab)

    panel = screen.getByRole('tabpanel', { name: 'plugin.auth.appUserAuth' })
    expect(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
    ).toHaveValue('Choose a Drive connection')
    expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(
      within(panel).getByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    )

    const reopened = await screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    expect(within(reopened).getByRole('textbox', { name: 'Client ID' })).toHaveValue('drive-client')
    expect(within(reopened).getByLabelText('Client Secret', { exact: false })).toHaveValue(
      '[__HIDDEN__]',
    )
    await user.click(within(reopened).getByRole('button', { name: 'common.operation.remove' }))
    await waitFor(() => expect(reopened).not.toBeInTheDocument())
    expect(mockOAuthClientMutations.remove).toHaveBeenCalledExactlyOnceWith()
    const configureAfterRemove = await within(panel).findByRole('button', {
      name: 'plugin.auth.common.configureClient',
    })
    expect(configureAfterRemove).toBeVisible()
    expect(configureAfterRemove).not.toHaveAccessibleDescription()
    expect(within(panel).queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    expect(
      within(panel).getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
    ).toHaveValue('Choose a Drive connection')
    expect(onDraftChange).toHaveBeenLastCalledWith({
      oauthEnabled: true,
      apiKeyEnabled: false,
      description: 'Choose a Drive connection',
      client: undefined,
    })
    for (const [draft] of onDraftChange.mock.calls) {
      if (draft.client) expect(draft.client).toEqual({ type: 'custom' })
    }

    await user.click(screen.getByRole('tab', { name: 'plugin.auth.workspaceAuth' }))
    const clearedWorkspaceSettings = await openWorkspaceClientSettings()
    expect(
      within(clearedWorkspaceSettings).getByRole('textbox', { name: 'Client ID' }),
    ).toHaveValue('')
    expect(
      within(clearedWorkspaceSettings).getByLabelText('Client Secret', { exact: false }),
    ).toHaveValue('')
    expect(
      within(clearedWorkspaceSettings).queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
    const schemaRequests = mockConsoleCall.mock.calls.filter(([path]) =>
      path.includes('clientSchema'),
    )
    expect(schemaRequests.length).toBeGreaterThan(0)
    for (const [, input] of schemaRequests) {
      expect(input).toEqual({ params: { provider: defaultPayload.provider } })
    }
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
    render(<ControlledPluginAuth />, { wrapper: createConnectionQueryWrapper() })
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
    expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      within(panel).getByRole('heading', { name: 'plugin.auth.appUser.userAuthentication' }),
    ).toBeVisible()
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

  it('preserves controlled methods and description when provider client status synchronizes', async () => {
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
    const ControlledPluginAuth = () => {
      const [draft, setDraft] = useState<AppUserAuthDraft>({
        oauthEnabled: false,
        apiKeyEnabled: false,
        description: 'Existing connection description',
      })
      return (
        <PluginAuth
          pluginPayload={defaultPayload}
          showAuthorizationTabs
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
    render(<ControlledPluginAuth />, { wrapper: createConnectionQueryWrapper() })
    const appUserTab = screen.getByRole('tab', { name: 'plugin.auth.appUserAuth' })
    await user.click(appUserTab)

    await waitFor(() =>
      expect(onDraftChange).toHaveBeenCalledExactlyOnceWith({
        oauthEnabled: false,
        apiKeyEnabled: false,
        description: 'Existing connection description',
        client: { type: 'default' },
      }),
    )
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

    expect(onDraftChange).toHaveBeenCalledTimes(1)
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

  it('disables authorization without credential.create and links to members settings', async () => {
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

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
    expect(screen.getByText('plugin.auth.permissionHint.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.permissionHint.description')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' }))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('members'),
    )
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
