import type { ReactElement } from 'react'
import type { AppUserAuthDraft } from '../draft'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import AppUserAuth from '..'
import { AuthCategory } from '../../types'
import { createAppUserAuthDraft } from '../draft'

const clientDialogName = 'plugin.auth.oauthClientSettings'
const clientIdLabel = 'Client ID'
const clientSecretLabel = 'Client Secret'
const saveLabel = 'plugin.auth.saveOnly'

type OAuthClientSchema = Awaited<
  ReturnType<
    typeof consoleClient.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get
  >
>

const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const mocks = vi.hoisted(() => ({
  consoleCall: vi.fn(),
  setOAuthClient: vi.fn(),
  deleteOAuthClient: vi.fn(),
  invalidOAuthClient: vi.fn(),
}))
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: (...args: unknown[]) => mocks.consoleCall(...args) },
}))
vi.mock('../../hooks/use-credential', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/use-credential')>()),
  useSetPluginOAuthCustomClientHook: () => ({ mutateAsync: mocks.setOAuthClient }),
  useDeletePluginOAuthCustomClientHook: () => ({ mutateAsync: mocks.deleteOAuthClient }),
  useInvalidPluginOAuthClientSchemaHook: () => mocks.invalidOAuthClient,
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const createClientSchema = (overrides: Partial<OAuthClientSchema> = {}): OAuthClientSchema => ({
  schema: [
    {
      name: 'client_id',
      label: { en_US: clientIdLabel },
      type: 'text-input',
      required: true,
      multiple: false,
    },
    {
      name: 'client_secret',
      label: { en_US: clientSecretLabel },
      type: 'secret-input',
      required: true,
      multiple: false,
    },
  ],
  is_oauth_custom_client_enabled: false,
  is_system_oauth_params_exists: false,
  client_params: {},
  redirect_uri: 'https://example.com/oauth/callback',
  ...overrides,
})
let serverClient: OAuthClientSchema
const clientQuery =
  consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get
const clientQueryInput = { params: { provider: pluginPayload.provider } }
const render = (
  ui: ReactElement,
  {
    loading = false,
    workspacePermissionKeys = ['credential.use', 'credential.create', 'credential.manage'],
  }: { loading?: boolean; workspacePermissionKeys?: string[] } = {},
) => {
  const queryClient = createConsoleQueryClient()
  if (!loading)
    queryClient.setQueryData(clientQuery.queryKey({ input: clientQueryInput }), serverClient)
  return renderWithConsoleQuery(ui, { queryClient, workspacePermissionKeys })
}

const ControlledHarness = ({
  initialDraft,
  onChange,
  canOAuth,
  canApiKey,
}: {
  initialDraft: AppUserAuthDraft
  onChange: (draft: AppUserAuthDraft) => void
  canOAuth?: boolean
  canApiKey?: boolean
}) => {
  const [draft, setDraft] = useState(initialDraft)

  return (
    <AppUserAuth
      pluginPayload={pluginPayload}
      canOAuth={canOAuth}
      canApiKey={canApiKey}
      value={draft}
      onChange={(nextDraft) => {
        setDraft(nextDraft)
        onChange(nextDraft)
      }}
    />
  )
}

const saveCustomClient = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'plugin.auth.common.configureClient' }))
  const dialog = await screen.findByRole('dialog', { name: clientDialogName })
  await user.type(within(dialog).getByRole('textbox', { name: clientIdLabel }), 'client-id')
  await user.type(
    within(dialog).getByLabelText(clientSecretLabel, { exact: false }),
    'client-secret',
  )
  await user.click(within(dialog).getByRole('button', { name: saveLabel }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
}

describe('AppUserAuth', () => {
  beforeEach(() => {
    serverClient = createClientSchema()
    mocks.consoleCall.mockImplementation(async (path: string[]) => {
      if (path.includes('clientSchema')) return serverClient
      if (path.includes('schema'))
        return [
          {
            name: 'api_key',
            label: { en_US: 'API key' },
            type: 'secret-input',
            required: true,
            multiple: false,
          },
        ]
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    })
    mocks.setOAuthClient.mockImplementation(
      async ({ client_params, enable_oauth_custom_client }) => {
        serverClient = {
          ...serverClient,
          is_oauth_custom_client_enabled: enable_oauth_custom_client,
          client_params: {
            ...client_params,
            ...(client_params.client_secret ? { client_secret: '[__HIDDEN__]' } : {}),
          },
        }
      },
    )
    mocks.deleteOAuthClient.mockImplementation(async () => {
      serverClient = { ...serverClient, is_oauth_custom_client_enabled: false, client_params: {} }
    })
  })
  it('enables both available methods by default and toggles the API key explanation', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth pluginPayload={pluginPayload} />)

    expect(screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })).toBeChecked()
    const apiKey = screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    expect(apiKey).toBeChecked()
    expect(screen.getByText('plugin.auth.appUser.apiKeyDescription')).toBeVisible()

    await user.click(apiKey)

    expect(apiKey).not.toBeChecked()
    expect(screen.queryByText('plugin.auth.appUser.apiKeyDescription')).not.toBeInTheDocument()

    await user.click(apiKey)

    expect(screen.getByText('plugin.auth.appUser.apiKeyDescription')).toBeVisible()
  })

  it.each([
    { mode: 'API key only', canOAuth: false, canApiKey: true },
    { mode: 'OAuth only', canOAuth: true, canApiKey: false },
    { mode: 'unsupported methods', canOAuth: false, canApiKey: false },
  ])(
    'normalizes old method flags for $mode while keeping configuration and description editable',
    async ({ canOAuth, canApiKey }) => {
      const user = userEvent.setup()
      const initialDraft = {
        ...createAppUserAuthDraft(),
        oauthEnabled: !canOAuth,
        apiKeyEnabled: !canApiKey,
      }
      const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
      render(
        <ControlledHarness
          initialDraft={initialDraft}
          onChange={onChange}
          canOAuth={canOAuth}
          canApiKey={canApiKey}
        />,
      )

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({
            oauthEnabled: canOAuth,
            apiKeyEnabled: canApiKey,
          }),
        ),
      )
      if (canOAuth) {
        expect(screen.getByRole('heading', { name: 'plugin.auth.oauthClient' })).toBeVisible()
        expect(screen.getByText('plugin.auth.appUser.oauthClientDescription')).toBeVisible()
        expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
        expect(
          screen.getByRole('button', { name: 'plugin.auth.common.configureClient' }),
        ).not.toHaveAccessibleDescription()
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ client: undefined }))
        await saveCustomClient(user)
        expect(
          screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }),
        ).toBeVisible()
      } else if (canApiKey) {
        expect(
          screen.getByRole('heading', { name: 'plugin.auth.appUser.userAuthentication' }),
        ).toBeVisible()
        expect(screen.getByText('plugin.auth.connection.apiKey')).toBeVisible()
        expect(screen.getByText('plugin.auth.common.required')).toBeVisible()
        expect(screen.getByText('plugin.auth.appUser.apiKeyRequiredDescription')).toBeVisible()
        expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
      }
      const description = screen.getByRole('textbox', {
        name: 'plugin.auth.appUser.connectionDescription',
      })
      await user.type(description, 'Use your account')
      expect(description).toHaveValue('Use your account')
      expect(description).not.toHaveAttribute('aria-invalid', 'true')
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          oauthEnabled: canOAuth,
          apiKeyEnabled: canApiKey,
          description: 'Use your account',
        }),
      )
    },
  )

  it('saves the shared custom client and retains its server configuration while OAuth is disabled', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth pluginPayload={pluginPayload} providerName="Google Drive" />)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.common.configureClient' }))
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    expect(
      within(dialog).queryByRole('radio', { name: 'plugin.auth.default' }),
    ).not.toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: clientIdLabel }), 'client-id')
    await user.type(
      within(dialog).getByLabelText(clientSecretLabel, { exact: false }),
      'client-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' })).toBeVisible()
    expect(
      screen.getByText(
        'plugin.auth.appUser.oauthDescriptionWithProvider:{"provider":"Google Drive"}',
      ),
    ).toBeVisible()
    expect(document.body).not.toHaveTextContent('client-secret')
    const oauth = screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    await user.click(oauth)
    expect(
      screen.queryByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    ).not.toBeInTheDocument()

    await user.click(oauth)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))

    const reopened = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(reopened).getByRole('textbox', { name: clientIdLabel })).toHaveValue('client-id')
    expect(within(reopened).getByLabelText(clientSecretLabel, { exact: false })).toHaveValue(
      '[__HIDDEN__]',
    )
    expect(mocks.setOAuthClient).toHaveBeenCalledExactlyOnceWith({
      client_params: { client_id: 'client-id', client_secret: 'client-secret' },
      enable_oauth_custom_client: true,
    })
  })

  it.each(['cancel', 'escape'] as const)(
    'discards client edits when closed with %s',
    async (close) => {
      const user = userEvent.setup()
      render(<AppUserAuth pluginPayload={pluginPayload} />)
      await saveCustomClient(user)
      await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))
      const dialog = await screen.findByRole('dialog', { name: clientDialogName })
      const clientId = within(dialog).getByRole('textbox', { name: clientIdLabel })
      const clientSecret = within(dialog).getByLabelText(clientSecretLabel, { exact: false })
      await user.clear(clientId)
      await user.type(clientId, 'unsaved-client')
      await user.clear(clientSecret)
      await user.type(clientSecret, 'unsaved-secret')

      if (close === 'cancel') {
        await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      } else {
        await user.keyboard('{Escape}')
      }
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))

      const reopened = await screen.findByRole('dialog', { name: clientDialogName })
      expect(within(reopened).getByRole('textbox', { name: clientIdLabel })).toHaveValue(
        'client-id',
      )
      expect(within(reopened).getByLabelText(clientSecretLabel, { exact: false })).toHaveValue(
        '[__HIDDEN__]',
      )
      expect(mocks.setOAuthClient).toHaveBeenCalledOnce()
    },
  )

  it('allows an available default client to replace custom client configuration', async () => {
    const user = userEvent.setup()
    serverClient = createClientSchema({ is_system_oauth_params_exists: true })
    render(<AppUserAuth pluginPayload={pluginPayload} />)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' }))
    let dialog = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(dialog).getByRole('radio', { name: 'plugin.auth.default' })).toBeChecked()
    expect(within(dialog).queryByRole('textbox', { name: clientIdLabel })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'plugin.auth.custom' }))
    await user.type(within(dialog).getByRole('textbox', { name: clientIdLabel }), 'client-id')
    await user.type(
      within(dialog).getByLabelText(clientSecretLabel, { exact: false }),
      'client-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))
    dialog = await screen.findByRole('dialog', { name: clientDialogName })
    await user.click(within(dialog).getByRole('radio', { name: 'plugin.auth.default' }))
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' }))
    const reopened = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(reopened).getByRole('radio', { name: 'plugin.auth.default' })).toBeChecked()
    expect(within(reopened).queryByRole('textbox', { name: clientIdLabel })).not.toBeInTheDocument()
  })

  it('uses the required provider fields and blocks saving an incomplete client', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth pluginPayload={pluginPayload} />)
    await user.click(screen.getByRole('button', { name: 'plugin.auth.common.configureClient' }))
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    const clientId = within(dialog).getByRole('textbox', { name: clientIdLabel })
    const clientSecret = within(dialog).getByLabelText(clientSecretLabel, { exact: false })
    expect(clientId).toBeRequired()
    expect(clientSecret).toBeRequired()
    expect(clientSecret).toHaveAccessibleName(clientSecretLabel)
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))

    expect(clientId).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.setOAuthClient).not.toHaveBeenCalled()
    expect(dialog).toBeVisible()
    await user.type(clientId, 'client-id')
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))
    expect(clientId).not.toHaveAttribute('aria-invalid', 'true')
    expect(clientSecret).toHaveAttribute('aria-invalid', 'true')
    await user.type(clientSecret, 'client-secret')
    await user.click(within(dialog).getByRole('button', { name: saveLabel }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' })).toBeVisible()
  })

  it('clears client metadata and its valid state when the shared custom client is removed', async () => {
    const user = userEvent.setup()
    serverClient = createClientSchema({
      is_oauth_custom_client_enabled: true,
      client_params: { client_id: 'existing-client', client_secret: '[__HIDDEN__]' },
    })
    const initialDraft = {
      ...createAppUserAuthDraft(),
      description: 'Drive account',
      client: { type: 'custom' as const },
    }
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }))
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    expect(within(dialog).getByRole('textbox', { name: clientIdLabel })).toHaveValue(
      'existing-client',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.remove' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(mocks.deleteOAuthClient).toHaveBeenCalledOnce()
    expect(mocks.setOAuthClient).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('button', { name: 'plugin.auth.common.configureClient' }),
    ).toHaveAccessibleDescription('plugin.auth.appUser.setupClient')
    expect(onChange).toHaveBeenLastCalledWith({ ...initialDraft, client: undefined })
    expect(JSON.stringify(onChange.mock.calls)).not.toContain('existing-client')
  })

  it('prevents opening client settings while the provider schema is loading, then uses the loaded configuration', async () => {
    const user = userEvent.setup()
    let resolveSchema!: (schema: OAuthClientSchema) => void
    const pendingSchema = new Promise<OAuthClientSchema>((resolve) => {
      resolveSchema = resolve
    })
    const originalCall = mocks.consoleCall.getMockImplementation()!
    mocks.consoleCall.mockImplementation((path: string[], ...args: unknown[]) =>
      path.includes('clientSchema') ? pendingSchema : originalCall(path, ...args),
    )
    render(<AppUserAuth pluginPayload={pluginPayload} />, { loading: true })
    const configure = screen.getByRole('button', { name: 'plugin.auth.common.configureClient' })
    expect(configure).toBeDisabled()
    await user.click(configure)
    expect(screen.queryByRole('dialog', { name: clientDialogName })).not.toBeInTheDocument()

    await act(async () =>
      resolveSchema(createClientSchema({ is_system_oauth_params_exists: true })),
    )
    expect(
      await screen.findByRole('button', { name: 'plugin.auth.appUser.defaultClient' }),
    ).toBeEnabled()
    expect(mocks.setOAuthClient).not.toHaveBeenCalled()
    expect(mocks.deleteOAuthClient).not.toHaveBeenCalled()
  })

  it.each([
    { workspacePermissionKeys: [], notAllowCustomCredential: false },
    { workspacePermissionKeys: ['credential.manage'], notAllowCustomCredential: true },
  ])(
    'prevents changing the provider client without permission or when custom credentials are locked',
    async (props) => {
      const user = userEvent.setup()
      render(
        <AppUserAuth
          pluginPayload={pluginPayload}
          notAllowCustomCredential={props.notAllowCustomCredential}
        />,
        { workspacePermissionKeys: props.workspacePermissionKeys },
      )
      const configure = screen.getByRole('button', { name: 'plugin.auth.common.configureClient' })
      expect(configure).toBeDisabled()
      await user.click(configure)
      expect(screen.queryByRole('dialog', { name: clientDialogName })).not.toBeInTheDocument()
      expect(mocks.setOAuthClient).not.toHaveBeenCalled()
      expect(mocks.deleteOAuthClient).not.toHaveBeenCalled()
    },
  )

  it('limits typed and pasted descriptions to 50 characters and updates the count and validity', async () => {
    const user = userEvent.setup()
    render(<AppUserAuth pluginPayload={pluginPayload} />)
    const description = screen.getByRole('textbox', {
      name: 'plugin.auth.appUser.connectionDescription',
    })
    expect(description).toBeRequired()
    expect(description).toHaveAccessibleDescription(/0\/50/)
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.type(description, 'Drive')
    expect(description).toHaveAccessibleDescription('5/50')
    await user.clear(description)
    expect(description).toHaveAttribute('aria-invalid', 'true')

    await user.type(description, 'T'.repeat(55))
    expect(description).toHaveValue('T'.repeat(50))
    expect(description).toHaveAccessibleDescription('50/50')
    await user.clear(description)
    await user.paste('P'.repeat(55))

    expect(description).toHaveValue('P'.repeat(50))
    expect(description).toHaveAccessibleDescription('50/50')
    expect(description).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('revalidates method choices immediately and accepts API key without a client', async () => {
    const user = userEvent.setup()
    const initialDraft = { ...createAppUserAuthDraft(), description: 'Drive account' }
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    const oauth = screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    const apiKey = screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    await user.click(oauth)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(oauth).not.toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    await user.click(apiKey)

    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      oauthEnabled: false,
      apiKeyEnabled: false,
    })
    expect(screen.getByText('plugin.auth.appUser.selectMethod')).toBeVisible()
    expect(oauth).toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(oauth).toHaveAccessibleDescription(/plugin\.auth\.appUser\.selectMethod/)
    expect(apiKey).toHaveAccessibleDescription(/plugin\.auth\.appUser\.selectMethod/)
    expect(
      screen.getByRole('group', { name: 'plugin.auth.authorization' }),
    ).toHaveAccessibleDescription('plugin.auth.appUser.selectMethod')

    await user.click(apiKey)
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      oauthEnabled: false,
      apiKeyEnabled: true,
    })
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(oauth).not.toHaveAttribute('aria-invalid', 'true')
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    await user.click(oauth)
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
  })

  it('keeps the OAuth client error while fixing the description and retains a saved client', async () => {
    const user = userEvent.setup()
    const initialDraft = createAppUserAuthDraft()
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    const configureClient = screen.getByRole('button', {
      name: 'plugin.auth.common.configureClient',
    })
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    expect(configureClient).toHaveAccessibleDescription('plugin.auth.appUser.setupClient')
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.type(
      screen.getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }),
      'Drive account',
    )
    expect(screen.queryByText('plugin.auth.appUser.enterDescription')).not.toBeInTheDocument()
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()
    await user.click(configureClient)
    const dialog = await screen.findByRole('dialog', { name: clientDialogName })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.getByText('plugin.auth.appUser.setupClient')).toBeVisible()

    await saveCustomClient(user)
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      description: 'Drive account',
      client: { type: 'custom' },
    })
    expect(JSON.stringify(onChange.mock.calls)).not.toContain('client-secret')
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' }),
    ).not.toHaveAccessibleDescription()
    const oauth = screen.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' })
    await user.click(oauth)
    await user.click(oauth)
    expect(screen.getByRole('button', { name: 'plugin.auth.appUser.customClient' })).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      description: 'Drive account',
      client: { type: 'custom' },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('revalidates empty and whitespace descriptions immediately as the user edits', async () => {
    const user = userEvent.setup()
    const initialDraft = createAppUserAuthDraft({ canOAuth: false })
    const onChange = vi.fn<(draft: AppUserAuthDraft) => void>()
    render(<ControlledHarness initialDraft={initialDraft} onChange={onChange} />)
    const input = screen.getByRole('textbox', {
      name: 'plugin.auth.appUser.connectionDescription',
    })
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/plugin\.auth\.appUser\.enterDescription/)
    expect(screen.queryByText('plugin.auth.appUser.selectMethod')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.auth.appUser.setupClient')).not.toBeInTheDocument()
    await user.type(input, '   ')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
    await user.clear(input)
    await user.type(input, 'Connect your Drive account')
    expect(onChange).toHaveBeenLastCalledWith({
      ...initialDraft,
      description: 'Connect your Drive account',
    })
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('plugin.auth.appUser.enterDescription')).not.toBeInTheDocument()
    await user.clear(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('plugin.auth.appUser.enterDescription')).toBeVisible()
  })
})
