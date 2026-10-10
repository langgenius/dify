import type { usePluginAuth } from '../../hooks/use-plugin-auth'
import type { Credential } from '../../types'
import type { ConnectionSelectorProps } from '../connection-selector'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import ConnectionSelector from '../connection-selector'

const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
  addCredential: vi.fn(),
  updateCredential: vi.fn(),
  setOAuthClient: vi.fn(),
  deleteOAuthClient: vi.fn(),
  invalidOAuthClient: vi.fn(),
  openOAuthPopup: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (...args: unknown[]) => mocks.consoleCall(...args),
  },
}))

vi.mock('../../hooks/use-credential', () => ({
  useGetPluginCredentialSchemaHook: () => ({
    data: [{ name: 'api_key', label: 'API Key', type: 'secret-input', required: true }],
    isLoading: false,
  }),
  useAddPluginCredentialHook: () => ({ mutateAsync: mocks.addCredential }),
  useUpdatePluginCredentialHook: () => ({ mutateAsync: mocks.updateCredential }),
  useSetPluginOAuthCustomClientHook: () => ({ mutateAsync: mocks.setOAuthClient }),
  useDeletePluginOAuthCustomClientHook: () => ({ mutateAsync: mocks.deleteOAuthClient }),
  useInvalidPluginOAuthClientSchemaHook: () => mocks.invalidOAuthClient,
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: mocks.openOAuthPopup,
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const apiSecret = 'sk-test-raw-secret-123456'
const oauthSecret = 'oauth-raw-access-token'
const credentials: Credential[] = [
  {
    id: 'workspace-api',
    name: 'Team API connection',
    provider: pluginPayload.provider,
    credential_type: CredentialTypeEnum.API_KEY,
    credentials: { api_key: 'sk********3456' },
    is_default: true,
    visibility: PermissionLevel.allTeamMembers,
    created_by: 'current-user',
  },
  {
    id: 'personal-oauth',
    name: 'Personal OAuth connection',
    provider: pluginPayload.provider,
    credential_type: CredentialTypeEnum.OAUTH2,
    credentials: { access_token: oauthSecret },
    is_default: false,
    visibility: PermissionLevel.onlyMe,
    created_by: 'current-user',
  },
  {
    id: 'raw-api',
    name: 'Raw API connection',
    provider: pluginPayload.provider,
    credential_type: CredentialTypeEnum.API_KEY,
    credentials: { api_key: apiSecret },
    is_default: false,
    visibility: PermissionLevel.allTeamMembers,
    created_by: 'current-user',
  },
]

const oauthClient = {
  schema: [],
  is_oauth_custom_client_enabled: false,
  is_system_oauth_params_exists: true,
  client_params: {},
  redirect_uri: 'https://example.com/oauth/callback',
}

const createAuthorization = (
  overrides: Partial<ReturnType<typeof usePluginAuth>> = {},
): ReturnType<typeof usePluginAuth> => ({
  isAuthorized: true,
  canOAuth: true,
  canApiKey: true,
  isLoading: false,
  credentials,
  notAllowCustomCredential: false,
  invalidPluginCredentialInfo: vi.fn(),
  ...overrides,
})

const renderSelector = (
  props: Partial<ConnectionSelectorProps> = {},
  workspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage'],
) => {
  const queryClient = createConsoleQueryClient()
  const providerQuery = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  queryClient.setQueryData(
    providerQuery.credential.schema.byCredentialType.get.queryKey({
      input: {
        params: { provider: pluginPayload.provider, credential_type: CredentialTypeEnum.API_KEY },
      },
    }),
    [
      {
        name: 'api_key',
        label: { en_US: 'API Key' },
        type: 'secret-input',
        required: true,
        multiple: false,
      },
    ],
  )
  queryClient.setQueryData(
    providerQuery.oauth.clientSchema.get.queryKey({
      input: { params: { provider: pluginPayload.provider } },
    }),
    oauthClient,
  )

  return renderWithConsoleQuery(
    <ConnectionSelector
      pluginPayload={pluginPayload}
      authorization={createAuthorization()}
      onAuthorizationItemClick={vi.fn()}
      {...props}
    />,
    { queryClient, accountProfile: { id: 'current-user' }, workspacePermissionKeys },
  )
}

describe('ConnectionSelector', () => {
  beforeEach(() => {
    mocks.consoleCall.mockImplementation(async (path: string[]) => {
      if (path.slice(-3).join('.') === 'oauth.clientSchema.get') return oauthClient
      return { result: 'success' }
    })
    mocks.addCredential.mockResolvedValue({})
    mocks.updateCredential.mockResolvedValue({})
    mocks.setOAuthClient.mockResolvedValue({})
    mocks.deleteOAuthClient.mockResolvedValue({})
  })

  it('shows the actual workspace default connection and masks its secret', async () => {
    const user = userEvent.setup()
    renderSelector()

    const trigger = screen.getByRole('button', { name: /Team API connection/ })
    expect(trigger).toHaveTextContent('Team API connection')
    expect(trigger.textContent).toMatch(/[*•]/)
    expect(document.body).not.toHaveTextContent(apiSecret)

    await user.click(trigger)

    expect(document.body).not.toHaveTextContent(apiSecret)
    expect(document.body).not.toHaveTextContent(oauthSecret)
  })

  it('shows the selected OAuth connection with its method when no account metadata is available', () => {
    renderSelector({ credentialId: 'personal-oauth' })

    const trigger = screen.getByRole('button', { name: /Personal OAuth connection/ })
    expect(trigger).toHaveTextContent('plugin.auth.connection.oauth')
    expect(document.body).not.toHaveTextContent(oauthSecret)
    expect(screen.queryByRole('button', { name: /Team API connection/ })).not.toBeInTheDocument()
  })

  it('groups connections by visibility and closes the popup after selecting a connection', async () => {
    const user = userEvent.setup()
    const onAuthorizationItemClick = vi.fn()
    renderSelector({ onAuthorizationItemClick })
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))

    const workspaceGroup = screen.getByRole('group', { name: 'common.userProfile.workspace' })
    const personalGroup = screen.getByRole('group', {
      name: 'datasetSettings.form.permissionsOnlyMe',
    })
    expect(
      within(workspaceGroup).getByRole('button', { name: /^Team API connection/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(workspaceGroup).getByRole('button', { name: /^Raw API connection/ }),
    ).toHaveTextContent('plugin.auth.connection.apiKey')
    const personalConnection = within(personalGroup).getByRole('button', {
      name: /^Personal OAuth connection/,
    })
    expect(personalConnection).toHaveAttribute('aria-pressed', 'false')

    await user.click(personalConnection)

    expect(onAuthorizationItemClick).toHaveBeenCalledWith('personal-oauth')
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
      ).not.toBeInTheDocument()
    })
  })

  it('clears the node override when following the workspace default connection', async () => {
    const user = userEvent.setup()
    const onAuthorizationItemClick = vi.fn()
    renderSelector({ credentialId: 'personal-oauth', onAuthorizationItemClick })
    await user.click(screen.getByRole('button', { name: /Personal OAuth connection/ }))
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Team API connection/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'plugin.auth.workspaceDefault' }))

    expect(onAuthorizationItemClick).toHaveBeenCalledWith('')
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
      ).not.toBeInTheDocument()
    })
  })

  it('keeps credential management unavailable without manage permission', async () => {
    const user = userEvent.setup()
    renderSelector({}, ['credential.use'])
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))

    expect(screen.getByRole('button', { name: 'plugin.auth.addOAuth' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'plugin.auth.connection.addApiKey' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'plugin.auth.connection.oauthClientSettings' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', {
        name: /common\.operation\.moreActionsFor.*Personal OAuth connection/,
      }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Team API connection/,
      }),
    )

    expect(
      screen.getByRole('menuitem', { name: 'plugin.auth.workspaceDefault' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.edit' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.rename' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })

  it('shows a borrowed connection separately and prevents managing it', async () => {
    const user = userEvent.setup()
    const borrowed = {
      ...credentials[1]!,
      id: 'borrowed-oauth',
      name: 'Borrowed connection',
      from_other_member: true,
      created_by: 'another-user',
    }
    renderSelector({
      credentialId: borrowed.id,
      authorization: createAuthorization({ credentials: [credentials[0]!, borrowed] }),
    })
    await user.click(screen.getByRole('button', { name: /Borrowed connection/ }))

    const group = screen.getByRole('group', { name: 'plugin.auth.connection.otherMembers' })
    expect(within(group).getByRole('button', { name: /^Borrowed connection/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(group).queryByRole('button', { name: /common\.operation\.moreActionsFor/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'datasetSettings.form.permissionsOnlyMe' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    { action: 'plugin.auth.connection.addApiKey', title: 'plugin.auth.useApiAuth' },
    { action: 'plugin.auth.addOAuth', title: 'plugin.auth.whoCanUse' },
    {
      action: 'plugin.auth.connection.oauthClientSettings',
      title: 'plugin.auth.oauthClientSettings',
    },
  ])(
    'keeps the $action dialog open after closing the connection popup',
    async ({ action, title }) => {
      const user = userEvent.setup()
      renderSelector()
      await user.click(screen.getByRole('button', { name: /Team API connection/ }))
      const actionButton = screen.getByRole('button', { name: action })
      await waitFor(() => expect(actionButton).toBeEnabled())
      await user.click(actionButton)

      const dialog = await screen.findByRole('dialog', { name: title })
      expect(dialog).toBeVisible()
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
        ).not.toBeInTheDocument()
      })
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument(),
      )
    },
  )

  it('keeps the API edit dialog usable after closing the popup and discards canceled changes', async () => {
    const user = userEvent.setup()
    renderSelector()
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Team API connection/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    expect(nameInput).toHaveValue('Team API connection')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated API connection')
    expect(dialog).toBeVisible()
    expect(
      screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'plugin.auth.useApiAuth' }),
      ).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Team API connection/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const reopenedDialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    expect(
      within(reopenedDialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
    ).toHaveValue('Team API connection')
  })

  it('opens deletion confirmation from the API edit dialog Remove action', async () => {
    const user = userEvent.setup()
    renderSelector()
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Team API connection/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))

    const editDialog = await screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
    await user.click(within(editDialog).getByRole('button', { name: 'common.operation.remove' }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'datasetDocuments.list.delete.title',
    })
    expect(confirmation).toHaveTextContent('Team API connection')
    expect(screen.queryByRole('dialog', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'delete', 'post'],
        { params: { provider: pluginPayload.provider }, body: { credential_id: 'workspace-api' } },
        expect.anything(),
      )
    })
  })

  it('renames an OAuth connection through the generated mutation after closing the popup', async () => {
    const user = userEvent.setup()
    const authorization = createAuthorization()
    renderSelector({ authorization })
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Personal OAuth connection/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.rename' }))

    const dialog = await screen.findByRole('dialog', { name: 'common.operation.rename' })
    const nameInput = within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated OAuth connection')
    expect(
      screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
    ).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'update', 'post'],
        {
          params: { provider: pluginPayload.provider },
          body: { credential_id: 'personal-oauth', name: 'Updated OAuth connection' },
        },
        expect.anything(),
      )
    })
    expect(authorization.invalidPluginCredentialInfo).toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'common.operation.rename' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('deletes a connection only after confirmation through the generated mutation', async () => {
    const user = userEvent.setup()
    const authorization = createAuthorization()
    renderSelector({ authorization })
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.moreActionsFor.*Personal OAuth connection/,
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: 'datasetDocuments.list.delete.title',
    })
    expect(dialog).toHaveTextContent('Personal OAuth connection')
    expect(mocks.consoleCall.mock.calls.some(([path]) => path.at(-2) === 'delete')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(mocks.consoleCall).toHaveBeenCalledWith(
        ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'delete', 'post'],
        { params: { provider: pluginPayload.provider }, body: { credential_id: 'personal-oauth' } },
        expect.anything(),
      )
    })
    expect(authorization.invalidPluginCredentialInfo).toHaveBeenCalled()
  })
})
