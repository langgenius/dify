import type { usePluginAuth } from '../../hooks/use-plugin-auth'
import type { Credential } from '../../types'
import type { ConnectionSelectorProps } from '../connection-selector'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/base/form/types'
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
  schema: [
    {
      name: 'client_id',
      label: { en_US: 'Client ID' },
      type: FormTypeEnum.textInput,
      required: true,
      multiple: false,
    },
  ],
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
    <TooltipProvider delay={0} closeDelay={0}>
      <ConnectionSelector
        pluginPayload={pluginPayload}
        authorization={createAuthorization()}
        onAuthorizationItemClick={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
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

  it.each([false, true])(
    'follows the default connection when its row is selected with default tracking %s',
    async (trackDefault) => {
      const user = userEvent.setup()
      const onAuthorizationItemClick = vi.fn()
      renderSelector({
        credentialId: 'personal-oauth',
        onAuthorizationItemClick,
        onDefaultCredentialChange: trackDefault ? vi.fn() : undefined,
      })
      await user.click(screen.getByRole('button', { name: /Personal OAuth connection/ }))
      const workspaceGroup = screen.getByRole('group', { name: 'common.userProfile.workspace' })
      await user.click(within(workspaceGroup).getByRole('button', { name: /^Team API connection/ }))

      expect(onAuthorizationItemClick).toHaveBeenCalledWith(trackDefault ? 'workspace-api' : '')
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
        ).not.toBeInTheDocument()
      })
    },
  )

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
      screen.queryByRole('button', { name: /common\.operation\.moreActionsFor/ }),
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

  it('copies the custom OAuth redirect URI without saving settings or starting authorization', async () => {
    const user = userEvent.setup()
    renderSelector()
    await user.click(screen.getByRole('button', { name: /Team API connection/ }))
    const settingsButton = screen.getByRole('button', {
      name: 'plugin.auth.connection.oauthClientSettings',
    })
    await waitFor(() => expect(settingsButton).toBeEnabled())
    await user.click(settingsButton)

    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    expect(within(dialog).getByRole('radio', { name: 'plugin.auth.default' })).toBeChecked()
    expect(within(dialog).queryByText(oauthClient.redirect_uri)).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'common.operation.copy' }),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'plugin.auth.custom' }))

    expect(within(dialog).getByText('plugin.auth.clientInfo')).toBeVisible()
    expect(within(dialog).getByText(oauthClient.redirect_uri)).toBeVisible()
    const clientId = within(dialog).getByRole('textbox', { name: 'Client ID' })
    expect(clientId).toBeRequired()
    expect(clientId).toHaveValue('')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.copy' }))

    expect(await navigator.clipboard.readText()).toBe(oauthClient.redirect_uri)
    expect(within(dialog).getByRole('button', { name: 'common.operation.copied' })).toBeVisible()
    expect(dialog).toBeVisible()
    expect(mocks.setOAuthClient).not.toHaveBeenCalled()
    expect(mocks.deleteOAuthClient).not.toHaveBeenCalled()
    expect(
      mocks.consoleCall.mock.calls.filter(([path]) => path.includes('authorizationUrl')),
    ).toEqual([])
    expect(mocks.openOAuthPopup).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'plugin.auth.whoCanUse' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'plugin.auth.default' }))

    expect(within(dialog).queryByText(oauthClient.redirect_uri)).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'common.operation.copied' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      name: 'Team API connection',
      action: 'plugin.auth.connection.edit',
      role: 'dialog',
      title: 'plugin.auth.connection.save',
      field: 'plugin.auth.connection.name',
    },
    {
      name: 'Personal OAuth connection',
      action: 'plugin.auth.connection.edit',
      role: 'dialog',
      title: 'plugin.auth.connection.save',
      field: 'plugin.auth.connection.name',
    },
    {
      name: 'Team API connection',
      action: 'plugin.auth.connection.replaceApiKey',
      role: 'dialog',
      title: 'plugin.auth.useApiAuth',
      field: 'plugin.auth.authorizationName',
    },
    {
      name: 'Personal OAuth connection',
      action: 'common.operation.remove',
      role: 'alertdialog',
      title: 'datasetDocuments.list.delete.title',
    },
  ])(
    'keeps $action for $name open after closing the connection popup',
    async ({ name, action, role, title, field }) => {
      const user = userEvent.setup()
      renderSelector()
      await user.click(screen.getByRole('button', { name: /Team API connection/ }))
      await user.click(
        screen.getByRole('button', {
          name: `common.operation.moreActionsFor:${JSON.stringify({ name })}`,
        }),
      )
      await user.click(screen.getByRole('menuitem', { name: action }))

      const dialog = await screen.findByRole(role, { name: title })
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'plugin.auth.authorization' }),
        ).not.toBeInTheDocument()
      })
      expect(dialog).toBeVisible()
      if (field) expect(within(dialog).getByRole('textbox', { name: field })).toHaveValue(name)
      else expect(dialog).toHaveTextContent(name)

      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    },
  )
})
