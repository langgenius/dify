import type { OAuthClientSettingsProps } from '../oauth-client-settings'
import type { FormSchema } from '@/app/components/base/form/types'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import { AuthCategory } from '../../types'

const mockGetPluginOAuthUrl = vi
  .fn()
  .mockResolvedValue({ authorization_url: 'https://auth.example.com' })
const mockOpenOAuthPopup = vi.fn()
const mockWriteText = vi.fn()
const mockOAuthClientSettingsProps: OAuthClientSettingsProps[] = []

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string> | string) =>
    typeof obj === 'string' ? obj : obj.en_US || '',
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

vi.mock('../../hooks/use-credential', () => ({
  useGetPluginOAuthUrlHook: () => {
    const [isPending, setIsPending] = React.useState(false)

    return {
      isPending,
      mutateAsync: async (params?: { visibility?: string }) => {
        setIsPending(true)
        try {
          return await mockGetPluginOAuthUrl(params)
        } finally {
          setIsPending(false)
        }
      },
    }
  },
  useGetPluginOAuthClientSchemaHook: () => ({
    data: {
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: true,
      client_params: {},
      redirect_uri: 'https://redirect.example.com',
    },
    isLoading: false,
  }),
}))

vi.mock('../oauth-client-settings', () => ({
  default: (props: OAuthClientSettingsProps) => {
    mockOAuthClientSettingsProps.push(props)
    const { open = true, onClose, onOpenChange, onRequestAuthorization, schemas } = props

    if (!open) return null

    const handleClose = () => {
      onOpenChange?.(false)
      onClose?.()
    }
    const handleSaveAndAuthorize = async () => {
      handleClose()
      await onRequestAuthorization?.()
    }

    return (
      <div data-testid="oauth-settings-modal">
        <button data-testid="oauth-settings-close" onClick={handleClose}>
          Close
        </button>
        <button type="button" onClick={handleSaveAndAuthorize}>
          plugin.auth.saveAndAuth
        </button>
        {schemas.map((schema) => (
          <div key={schema.name} data-testid={`oauth-schema-${schema.name}`}>
            <div data-testid={`oauth-schema-label-${schema.name}`}>
              {React.isValidElement(schema.label) ? schema.label : String(schema.label || '')}
            </div>
            {String(schema.default || '')}
          </div>
        ))}
      </div>
    )
  },
}))

vi.mock('@/app/components/base/form/types', () => ({
  FormTypeEnum: { radio: 'radio' },
}))

vi.mock('@langgenius/dify-ui/cn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('AddOAuthButton', () => {
  let AddOAuthButton: (typeof import('../add-oauth-button'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    mockOAuthClientSettingsProps.length = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWriteText },
    })
    const mod = await import('../add-oauth-button')
    AddOAuthButton = mod.default
  })

  it('should render OAuth button when configured (system params exist)', () => {
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    expect(screen.getByText('Use OAuth')).toBeInTheDocument()
  })

  it('should expose the default trigger to an external overlay owner', () => {
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={basePayload}
        buttonText="Use OAuth"
        renderTrigger={({ trigger }) => <div data-testid="external-owner">{trigger}</div>}
      />,
    )

    expect(within(screen.getByTestId('external-owner')).getByText('Use OAuth')).toBeInTheDocument()
  })

  it('should open OAuth settings modal when settings icon clicked', () => {
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    fireEvent.click(screen.getByRole('button', { name: /plugin\.auth\.oauthClientSettings/i }))

    expect(screen.getByTestId('oauth-settings-modal')).toBeInTheDocument()
    expect(mockOAuthClientSettingsProps.at(-1)?.open).toBe(true)
  })

  it('should close OAuth settings modal', () => {
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    fireEvent.click(screen.getByRole('button', { name: /plugin\.auth\.oauthClientSettings/i }))
    fireEvent.click(screen.getByTestId('oauth-settings-close'))

    expect(screen.queryByTestId('oauth-settings-modal')).not.toBeInTheDocument()
  })

  it('should trigger OAuth flow on main button click', async () => {
    const mockOnUpdate = vi.fn()
    renderWithAccountProfile(
      <AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" onUpdate={mockOnUpdate} />,
    )

    const button = screen.getByText('Use OAuth').closest('button')
    if (button) fireEvent.click(button)

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
    expect(handleOAuthSuccess).toBeTypeOf('function')
    if (typeof handleOAuthSuccess === 'function') handleOAuthSuccess()

    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('should not open OAuth popup when authorization URL is missing', async () => {
    const user = userEvent.setup()
    mockGetPluginOAuthUrl.mockResolvedValueOnce({})
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(screen.getByRole('button', { name: 'Use OAuth' }))

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

    await user.click(screen.getByRole('button', { name: 'Use OAuth' }))
    const dialog = await screen.findByRole('dialog', { name: 'plugin.auth.whoCanUse' })
    const confirmButton = within(dialog).getByRole('button', { name: 'plugin.auth.authorize' })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(confirmButton).toHaveAttribute('aria-disabled', 'true')
    })
    expect(confirmButton).toHaveAttribute('aria-busy', 'true')
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

    await user.click(screen.getByRole('button', { name: 'Use OAuth' }))
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
    expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith({ visibility: 'all_team_members' })
    expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', {
        name: /datasetSettings\.form\.permissionsAllMember/,
      }),
    ).toBeEnabled()
  })

  it('should skip visibility picker for categories without backend visibility support', async () => {
    // Trigger / model OAuth endpoints don't yet accept a visibility value on
    // the backend — the picker would let users select "Only me" while the
    // credential silently defaults to all_team_members. Tool and datasource
    // are both wired end-to-end so they DO get the picker.
    const triggerPayload = { category: AuthCategory.trigger, provider: 'test-trigger' }
    renderWithAccountProfile(
      <AddOAuthButton pluginPayload={triggerPayload} buttonText="Use OAuth" />,
    )

    const button = screen.getByText('Use OAuth').closest('button')
    if (button) fireEvent.click(button)

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith(undefined)
    })
    // No pre-OAuth visibility modal should ever appear for unsupported categories.
    expect(screen.queryByText('plugin.auth.authorize')).not.toBeInTheDocument()
  })

  it('should show visibility picker for datasource category (backend now supports it)', async () => {
    const datasourcePayload = { category: AuthCategory.datasource, provider: 'test-datasource' }
    renderWithAccountProfile(
      <AddOAuthButton pluginPayload={datasourcePayload} buttonText="Use OAuth" />,
    )

    const button = screen.getByText('Use OAuth').closest('button')
    if (button) fireEvent.click(button)

    // Visibility picker appears for datasource just like it does for tool.
    const confirmButton = await screen.findByText('plugin.auth.authorize')
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith({ visibility: 'only_me' })
    })
  })

  it('should pass the selected shared visibility to the OAuth URL request', async () => {
    const user = userEvent.setup()
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(screen.getByRole('button', { name: 'Use OAuth' }))
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
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith({
        visibility: 'all_team_members',
      })
    })
  })

  it('should discard a cancelled visibility selection before the next OAuth attempt', async () => {
    const user = userEvent.setup()
    renderWithAccountProfile(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    await user.click(screen.getByRole('button', { name: 'Use OAuth' }))
    await user.click(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    )
    await user.click(
      screen.getByRole('menuitemradio', {
        name: 'datasetSettings.form.permissionsAllMember',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await user.click(screen.getByRole('button', { name: 'Use OAuth' }))
    await user.click(screen.getByRole('button', { name: 'plugin.auth.authorize' }))

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith({ visibility: 'only_me' })
    })
  })

  it('should be disabled when disabled prop is true', () => {
    renderWithAccountProfile(
      <AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" disabled />,
    )

    const button = screen.getByText('Use OAuth').closest('button')
    expect(button).toBeDisabled()
  })

  it('should open OAuth settings from setup entry when OAuth is not configured', () => {
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

    fireEvent.click(screen.getByText('plugin.auth.setupOAuth'))

    expect(screen.getByTestId('oauth-settings-modal')).toBeInTheDocument()
    expect(mockOAuthClientSettingsProps.at(-1)?.editValues).toMatchObject({
      __oauth_client__: 'custom',
    })
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

    await user.click(screen.getByText('plugin.auth.setupOAuth'))
    await user.click(
      within(screen.getByTestId('oauth-settings-modal')).getByRole('button', {
        name: 'plugin.auth.saveAndAuth',
      }),
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
      expect(mockGetPluginOAuthUrl).toHaveBeenCalledWith({
        visibility: 'all_team_members',
      })
    })
  })

  it('should show custom badge when OAuth custom client is enabled', () => {
    renderWithAccountProfile(
      <AddOAuthButton
        pluginPayload={basePayload}
        buttonText="Use OAuth"
        oAuthData={{
          schema: [],
          is_oauth_custom_client_enabled: true,
          is_system_oauth_params_exists: true,
          client_params: {},
        }}
      />,
    )

    expect(screen.getByText('plugin.auth.custom')).toBeInTheDocument()
  })

  it('should build custom OAuth schema and edit values for settings modal', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /plugin\.auth\.oauthClientSettings/i }))

    const settingsProps = mockOAuthClientSettingsProps.at(-1)
    expect(settingsProps?.editValues).toMatchObject({
      __oauth_client__: 'custom',
      client_id: 'stored-client-id',
    })
    expect(settingsProps?.hasOriginalClientParams).toBe(true)
    expect(settingsProps?.schemas[0]).toMatchObject({
      name: '__oauth_client__',
      default: 'custom',
    })
    expect(settingsProps?.schemas[1]).toMatchObject({
      name: 'client_id',
      default: 'stored-client-id',
      show_on: [
        {
          variable: '__oauth_client__',
          value: 'custom',
        },
      ],
    })
    expect(screen.getByText('https://redirect.example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.copy' }))

    expect(mockWriteText).toHaveBeenCalledWith('https://redirect.example.com')
  })
})
