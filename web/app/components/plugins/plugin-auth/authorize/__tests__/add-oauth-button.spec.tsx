import type { OAuthClientSettingsProps } from '../oauth-client-settings'
import type { FormSchema } from '@/app/components/base/form/types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockGetPluginOAuthUrl = vi.fn().mockResolvedValue({ authorization_url: 'https://auth.example.com' })
const mockOpenOAuthPopup = vi.fn()
const mockWriteText = vi.fn()
const mockOAuthClientSettingsProps: OAuthClientSettingsProps[] = []

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string> | string) => typeof obj === 'string' ? obj : obj.en_US || '',
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

vi.mock('../../hooks/use-credential', () => ({
  useGetPluginOAuthUrlHook: () => ({
    mutateAsync: mockGetPluginOAuthUrl,
  }),
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
    const {
      open = true,
      onClose,
      onOpenChange,
      schemas,
    } = props

    if (!open)
      return null

    const handleClose = () => {
      onOpenChange?.(false)
      onClose?.()
    }

    return (
      <div data-testid="oauth-settings-modal">
        <button data-testid="oauth-settings-close" onClick={handleClose}>Close</button>
        {schemas.map(schema => (
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
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    expect(screen.getByText('Use OAuth')).toBeInTheDocument()
  })

  it('should open OAuth settings modal when settings icon clicked', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    fireEvent.click(screen.getByRole('button', { name: /plugin\.auth\.oauthClientSettings/i }))

    expect(screen.getByTestId('oauth-settings-modal')).toBeInTheDocument()
    expect(mockOAuthClientSettingsProps.at(-1)?.open).toBe(true)
  })

  it('should close OAuth settings modal', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    fireEvent.click(screen.getByRole('button', { name: /plugin\.auth\.oauthClientSettings/i }))
    fireEvent.click(screen.getByTestId('oauth-settings-close'))

    expect(screen.queryByTestId('oauth-settings-modal')).not.toBeInTheDocument()
  })

  it('should trigger OAuth flow on main button click', async () => {
    const mockOnUpdate = vi.fn()
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" onUpdate={mockOnUpdate} />)

    const button = screen.getByText('Use OAuth').closest('button')
    if (button)
      fireEvent.click(button)

    await waitFor(() => {
      expect(mockOpenOAuthPopup).toHaveBeenCalledWith('https://auth.example.com', expect.any(Function))
    })

    const handleOAuthSuccess = mockOpenOAuthPopup.mock.calls[0]?.[1]
    expect(handleOAuthSuccess).toBeTypeOf('function')
    if (typeof handleOAuthSuccess === 'function')
      handleOAuthSuccess()

    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('should not open OAuth popup when authorization URL is missing', async () => {
    mockGetPluginOAuthUrl.mockResolvedValueOnce({})
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    const button = screen.getByText('Use OAuth').closest('button')
    if (button)
      fireEvent.click(button)

    await waitFor(() => {
      expect(mockGetPluginOAuthUrl).toHaveBeenCalled()
    })
    expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
  })

  it('should be disabled when disabled prop is true', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" disabled />)

    const button = screen.getByText('Use OAuth').closest('button')
    expect(button).toBeDisabled()
  })

  it('should open OAuth settings from setup entry when OAuth is not configured', () => {
    render(
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

  it('should show custom badge when OAuth custom client is enabled', () => {
    render(
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

    render(
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

    fireEvent.click(within(screen.getByTestId('oauth-schema-label-client_id')).getByRole('button'))

    expect(mockWriteText).toHaveBeenCalledWith('https://redirect.example.com')
  })
})
