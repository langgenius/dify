import type { ReactElement } from 'react'
import type { FormSchema } from '@/app/components/base/form/types'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AuthCategory } from '../../types'
import AddOAuthButton from '../add-oauth-button'

const mockGetPluginOAuthUrl = vi
  .fn()
  .mockResolvedValue({ authorization_url: 'https://auth.example.com' })
const mockOpenOAuthPopup = vi.fn()
const mockWriteText = vi.fn()
const mockSaveClient = vi.fn()

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string> | string) =>
    typeof obj === 'string' ? obj : obj.en_US || '',
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (url: string, _init: RequestInit, options: { request: Request }) => {
    const target = new URL(url)
    const path = target.pathname.replace('/console/api', '')
    if (path.endsWith('/oauth/client-schema'))
      return Response.json({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        client_params: {},
        redirect_uri: '',
      })
    if (options.request.method === 'POST')
      return Response.json(await mockSaveClient(path, { body: await options.request.json() }))
    return Response.json(
      await mockGetPluginOAuthUrl(path, {
        params: { visibility: target.searchParams.get('visibility') ?? undefined },
      }),
    )
  },
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn() } }))

// Give every category explicit configuration; datasource/trigger have no schema endpoint.
const renderWithAccountProfile = (element: ReactElement) => renderWithConsoleQuery(element)
const configuredOAuthData = {
  schema: [],
  is_oauth_custom_client_enabled: false,
  is_system_oauth_params_exists: true,
  client_params: {},
}
const toolAuthUrl = '/oauth/plugin/test-provider/tool/authorization-url'

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('AddOAuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveClient.mockResolvedValue({ result: 'success' })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWriteText },
    })
  })

  it('opens real OAuth settings and dismisses without saving', async () => {
    const user = userEvent.setup()
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)
    await user.click(await screen.findByRole('button', { name: 'plugin.auth.oauthClientSettings' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockSaveClient).not.toHaveBeenCalled()
  })

  it('should trigger OAuth flow on main button click', async () => {
    const mockOnUpdate = vi.fn()
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={basePayload}
        buttonText="Use OAuth"
        onUpdate={mockOnUpdate}
        renderTrigger={({ trigger }) => <section aria-label="External owner">{trigger}</section>}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Use OAuth' }))

    // Confirm the visibility picker to actually kick off OAuth
    const confirmButton = await screen.findByText('plugin.auth.authorize')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
        'https://auth.example.com',
        expect.any(Function),
      )
    })

    const handleOAuthSuccess = mockOpenOAuthPopup.mock.calls[0]?.[1]
    act(() => handleOAuthSuccess())

    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('should not open OAuth popup when authorization URL is missing', async () => {
    const user = userEvent.setup()
    mockGetPluginOAuthUrl.mockResolvedValueOnce({})
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(await screen.findByRole('button', { name: 'Use OAuth' }))

    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.whoCanUse' })
    expect(dialog).toHaveAccessibleDescription('plugin.auth.oauthCredentialPermissionDescription')

    const confirmButton = within(dialog).getByRole('button', { name: 'plugin.auth.authorize' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalled()
    })
    expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
    expect(confirmButton).toBeEnabled()
  })

  it('should lock the visibility dialog while requesting an OAuth URL', async () => {
    const user = userEvent.setup()
    let resolveOAuthRequest: ((value: { authorization_url: string }) => void) | undefined
    mockGetPluginOAuthUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOAuthRequest = resolve
        }),
    )
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(await screen.findByRole('button', { name: 'Use OAuth' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.whoCanUse' })
    const confirmButton = within(dialog).getByRole('button', { name: 'plugin.auth.authorize' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(confirmButton).toHaveAttribute('aria-disabled', 'true')
    })
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expect(
      within(dialog).getByRole('button', {
        name: /datasetSettings\.form\.permissionsOnlyMe/,
      }),
    ).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toBeDisabled()

    await act(async () => {
      resolveOAuthRequest?.({ authorization_url: 'https://auth.example.com' })
    })

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'plugin.auth.whoCanUse' }),
      ).not.toBeInTheDocument()
    })
    expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
      'https://auth.example.com',
      expect.any(Function),
    )
  })

  it('should preserve the visibility selection when the OAuth URL request fails', async () => {
    const user = userEvent.setup()
    mockGetPluginOAuthUrl.mockRejectedValueOnce(new Error('OAuth URL request failed'))
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(await screen.findByRole('button', { name: 'Use OAuth' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.whoCanUse' })
    await user.click(
      within(dialog).getByRole('button', {
        name: /datasetSettings\.form\.permissionsOnlyMe/,
      }),
    )
    await user.click(
      screen.getByRole('menuitemradio', {
        name: 'datasetSettings.form.permissionsAllMember',
      }),
    )
    const confirmButton = within(dialog).getByRole('button', { name: 'plugin.auth.authorize' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(confirmButton).toBeEnabled()
    })
    expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith(toolAuthUrl, {
      params: { visibility: 'all_team_members' },
    })
    expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', {
        name: /datasetSettings\.form\.permissionsAllMember/,
      }),
    ).toBeEnabled()
    await user.click(confirmButton)
    await waitFor(() => expect(mockOpenOAuthPopup).toHaveBeenCalledOnce())
    expect(mockGetPluginOAuthUrl).toHaveBeenLastCalledWith(toolAuthUrl, {
      params: { visibility: 'all_team_members' },
    })
  })

  it('should skip visibility picker for categories without backend visibility support', async () => {
    // This shared hook has no endpoint for trigger/model OAuth.
    const triggerPayload = { category: AuthCategory.trigger, provider: 'test-trigger' }
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={triggerPayload}
        buttonText="Use OAuth"
        oAuthData={configuredOAuthData}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Use OAuth' }))

    expect(mockGetPluginOAuthUrl).not.toHaveBeenCalled()
    expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
    // No pre-OAuth visibility modal should ever appear for unsupported categories.
    expect(screen.queryByText('plugin.auth.authorize')).not.toBeInTheDocument()
  })

  it('should show visibility picker for datasource category (backend now supports it)', async () => {
    const datasourcePayload = { category: AuthCategory.datasource, provider: 'test-datasource' }
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={datasourcePayload}
        buttonText="Use OAuth"
        oAuthData={configuredOAuthData}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Use OAuth' }))

    // Visibility picker appears for datasource just like it does for tool.
    const confirmButton = await screen.findByText('plugin.auth.authorize')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith(
        '/oauth/plugin/test-datasource/datasource/get-authorization-url',
        { params: { visibility: 'only_me' } },
      )
    })
  })

  it('should discard a cancelled visibility selection before the next OAuth attempt', async () => {
    const user = userEvent.setup()
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(await screen.findByRole('button', { name: 'Use OAuth' }))
    await user.click(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    )
    await user.click(
      screen.getByRole('menuitemradio', {
        name: 'datasetSettings.form.permissionsAllMember',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await user.click(await screen.findByRole('button', { name: 'Use OAuth' }))
    await user.click(screen.getByRole('button', { name: 'plugin.auth.authorize' }))

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith(toolAuthUrl, {
        params: { visibility: 'only_me' },
      })
    })
  })

  it('disables both authorization and client settings entry points', () => {
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={basePayload}
        buttonText="Use OAuth"
        oAuthData={configuredOAuthData}
        disabled
      />,
    )
    expect(screen.getByRole('button', { name: 'Use OAuth' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'plugin.auth.oauthClientSettings' })).toBeDisabled()
  })

  it('should choose visibility after saving custom OAuth settings for authorization', async () => {
    const user = userEvent.setup()
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={basePayload}
        oAuthData={{
          schema: [],
          is_oauth_custom_client_enabled: false,
          is_system_oauth_params_exists: false,
          client_params: {},
        }}
      />,
    )

    await user.click(screen.getByText('plugin.auth.common.configureClient'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'plugin.auth.oauthClientSettings' })).getByRole(
        'button',
        {
          name: 'plugin.auth.saveAndAuth',
        },
      ),
    )

    await screen.findByRole('dialog', { name: 'plugin.auth.whoCanUse' })
    expect(mockSaveClient).toHaveBeenCalledWith(
      '/workspaces/current/tool-provider/builtin/test-provider/oauth/custom-client',
      { body: { client_params: {}, enable_oauth_custom_client: true } },
    )
    expect(mockGetPluginOAuthUrl).not.toHaveBeenCalled()
    expect(screen.getByText('plugin.auth.oauthCredentialPermissionDescription')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    )
    await user.click(
      screen.getByRole('menuitemradio', {
        name: 'datasetSettings.form.permissionsAllMember',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'plugin.auth.authorize' }))

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith(toolAuthUrl, {
        params: { visibility: 'all_team_members' },
      })
    })
  })

  it('edits the stored custom client and copies its redirect URL through real settings', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const schema = [
      {
        name: 'client_id',
        label: { en_US: 'Client ID' },
        type: 'text-input',
        required: true,
        default: 'schema-client-id',
      },
    ] as FormSchema[]

    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={basePayload}
        buttonText="Use OAuth"
        oAuthData={{
          schema,
          is_oauth_custom_client_enabled: true,
          is_system_oauth_params_exists: true,
          client_params: { client_id: 'stored-client-id' },
          redirect_uri: 'https://redirect.example.com',
        }}
      />,
    )

    expect(screen.getByRole('button', { name: /Use OAuth/ })).toHaveTextContent(
      'plugin.auth.custom',
    )
    await user.click(screen.getByRole('button', { name: 'plugin.auth.oauthClientSettings' }))
    const input = screen.getByRole('textbox', { name: /Client ID/ })
    expect(input).toHaveValue('stored-client-id')
    expect(screen.getByRole('button', { name: 'common.operation.remove' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://redirect.example.com')
    await user.clear(input)
    await user.type(input, 'updated-client-id')
    await user.click(screen.getByRole('button', { name: 'plugin.auth.saveOnly' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockSaveClient).toHaveBeenCalledExactlyOnceWith(
      '/workspaces/current/tool-provider/builtin/test-provider/oauth/custom-client',
      {
        body: {
          client_params: { client_id: 'updated-client-id' },
          enable_oauth_custom_client: true,
        },
      },
    )
  })
})
