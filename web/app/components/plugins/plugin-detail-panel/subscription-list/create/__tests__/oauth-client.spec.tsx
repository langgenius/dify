import type {
  TriggerOAuthConfig,
  TriggerSubscriptionBuilder,
} from '@/app/components/workflow/block-selector/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { createHttpError } from '@/service/http-error'
import { OAuthClientSettingsModal } from '../oauth-client'

type PluginDetail = {
  plugin_id: string
  provider: string
  name: string
}

function createMockOAuthConfig(overrides: Partial<TriggerOAuthConfig> = {}): TriggerOAuthConfig {
  return {
    configured: true,
    custom_configured: false,
    custom_enabled: false,
    system_configured: true,
    redirect_uri: 'https://example.com/oauth/callback',
    params: {
      client_id: 'default-client-id',
      client_secret: 'default-client-secret',
    },
    oauth_client_schema: [
      {
        name: 'client_id',
        type: 'text-input' as unknown,
        required: true,
        label: { 'en-US': 'Client ID' } as unknown,
      },
      {
        name: 'client_secret',
        type: 'secret-input' as unknown,
        required: true,
        label: { 'en-US': 'Client Secret' } as unknown,
      },
    ] as TriggerOAuthConfig['oauth_client_schema'],
    ...overrides,
  }
}

function createMockPluginDetail(overrides: Partial<PluginDetail> = {}): PluginDetail {
  return {
    plugin_id: 'test-plugin-id',
    provider: 'test-provider',
    name: 'Test Plugin',
    ...overrides,
  }
}

function createMockSubscriptionBuilder(
  overrides: Partial<TriggerSubscriptionBuilder> = {},
): TriggerSubscriptionBuilder {
  return {
    id: 'builder-123',
    name: 'Test Builder',
    provider: 'test-provider',
    credential_type: TriggerCredentialType.Oauth2,
    credentials: {},
    endpoint: 'https://example.com/callback',
    parameters: {},
    properties: {},
    workflows_in_use: 0,
    ...overrides,
  }
}

const mockPluginDetail = createMockPluginDetail()
const mockUsePluginStore = vi.fn(() => mockPluginDetail)
vi.mock('../../../store', () => ({
  usePluginStore: () => mockUsePluginStore(),
}))

const mockInitiateOAuth = vi.fn()
const mockVerifyBuilder = vi.fn()
const mockConfigureOAuth = vi.fn()
const mockDeleteOAuth = vi.fn()

vi.mock('@/service/use-triggers', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const { createTestQueryClient } = await import('@/test/query-client')
  const mutationClient = createTestQueryClient()
  return {
    useInitiateTriggerOAuth: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockInitiateOAuth(variables), ...options },
        mutationClient,
      ),
    useVerifyAndUpdateTriggerSubscriptionBuilder: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockVerifyBuilder(variables), ...options },
        mutationClient,
      ),
    useConfigureTriggerOAuth: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockConfigureOAuth(variables), ...options },
        mutationClient,
      ),
    useDeleteTriggerOAuth: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockDeleteOAuth(variables), ...options },
        mutationClient,
      ),
  }
})

const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (url: string, callback: (data: unknown) => void) =>
    mockOpenOAuthPopup(url, callback),
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: Object.assign(
    (message: string, options?: { type?: string }) =>
      mockToastNotify({ type: options?.type, message }),
    {
      success: (message: string) => mockToastNotify({ type: 'success', message }),
      error: (message: string) => mockToastNotify({ type: 'error', message }),
      warning: (message: string) => mockToastNotify({ type: 'warning', message }),
      info: (message: string) => mockToastNotify({ type: 'info', message }),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    },
  ),
}))

const mockClipboardWriteText = vi.fn()
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: mockClipboardWriteText,
  },
  configurable: true,
  writable: true,
})

let mockFormValues: { values: Record<string, string>; isCheckValidated: boolean } = {
  values: { client_id: 'test-client-id', client_secret: 'test-client-secret' },
  isCheckValidated: true,
}
const setMockFormValues = (values: typeof mockFormValues) => {
  mockFormValues = values
}

vi.mock('@/app/components/base/form/components/base', () => ({
  BaseForm: ({
    formSchemas,
    ref,
  }: {
    formSchemas: Array<{ name: string; default?: string }>
    ref?: React.Ref<{
      getFormValues: () => { values: Record<string, string>; isCheckValidated: boolean }
    }>
  }) => {
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return (
      <div data-testid="base-form">
        {formSchemas.map((schema) => (
          <input
            key={schema.name}
            data-testid={`form-field-${schema.name}`}
            name={schema.name}
            defaultValue={schema.default || ''}
          />
        ))}
      </div>
    )
  },
}))

describe('OAuthClientSettingsModal', () => {
  const defaultProps = {
    open: true,
    oauthConfig: createMockOAuthConfig(),
    onOpenChange: vi.fn(),
    showOAuthCreateModal: vi.fn(),
  }
  const title = 'pluginTrigger.modal.oauth.title'
  const getDialog = () => screen.getByRole('dialog', { name: title })
  const getCloseButton = () => screen.getByRole('button', { name: 'common.operation.close' })
  const getCancelButton = () => screen.getByRole('button', { name: 'common.operation.cancel' })
  const getSaveOnlyButton = () => screen.getByRole('button', { name: 'plugin.auth.saveOnly' })
  const getConfirmButton = () =>
    screen.getByRole('button', {
      name: /plugin\.auth\.saveAndAuth|pluginTrigger\.modal\.common\.authorizing|pluginTrigger\.modal\.oauth\.authorization\.waitingJump/,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockInitiateOAuth.mockResolvedValue({
      authorization_url: 'https://oauth.example.com/authorize',
      subscription_builder: createMockSubscriptionBuilder(),
    })
    mockVerifyBuilder.mockResolvedValue({ verified: false })
    mockUsePluginStore.mockReturnValue(mockPluginDetail)
    mockClipboardWriteText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockClipboardWriteText,
      },
      configurable: true,
      writable: true,
    })
    setMockFormValues({
      values: { client_id: 'test-client-id', client_secret: 'test-client-secret' },
      isCheckValidated: true,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render modal with correct title', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    })

    it('should render client type selector when system_configured is true', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(
        screen.getByText('pluginTrigger.subscription.addType.options.oauth.default'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('pluginTrigger.subscription.addType.options.oauth.custom'),
      ).toBeInTheDocument()
    })

    it('should not render client type selector when system_configured is false', () => {
      const configWithoutSystemConfigured = createMockOAuthConfig({
        system_configured: false,
      })

      render(
        <OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithoutSystemConfigured} />,
      )

      expect(
        screen.queryByText('pluginTrigger.subscription.addType.options.oauth.default'),
      ).not.toBeInTheDocument()
    })

    it('should render redirect URI info when custom client type is selected', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      expect(screen.getByText('pluginTrigger.modal.oauthRedirectInfo')).toBeInTheDocument()
      expect(screen.getByText('https://example.com/oauth/callback')).toBeInTheDocument()
    })

    it('should render client form when custom type is selected', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      expect(screen.getByTestId('base-form')).toBeInTheDocument()
    })

    it('should show remove button when custom_enabled and params exist', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
    })
  })

  describe('Client Type Selection', () => {
    it('should default to Default client type when system_configured is true', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      const defaultCard = screen
        .getByText('pluginTrigger.subscription.addType.options.oauth.default')
        .closest('div')
      expect(defaultCard).toHaveClass('border-[1.5px]')
    })

    it('should switch to Custom client type when Custom card is clicked', async () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      const customCard = screen
        .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
        .closest('div')
      await act(async () => {
        fireEvent.click(customCard!)
      })

      expect(customCard).toHaveClass('border-[1.5px]')
    })

    it('should switch back to Default client type when Default card is clicked', async () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      const customCard = screen
        .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
        .closest('div')
      await act(async () => {
        fireEvent.click(customCard!)
      })

      const defaultCard = screen
        .getByText('pluginTrigger.subscription.addType.options.oauth.default')
        .closest('div')
      await act(async () => {
        fireEvent.click(defaultCard!)
      })

      expect(defaultCard).toHaveClass('border-[1.5px]')
    })
  })

  describe('Copy Redirect URI', () => {
    it('should copy redirect URI when copy button is clicked', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      const copyButton = screen.getByText('common.operation.copy')
      await act(async () => {
        fireEvent.click(copyButton)
      })

      await waitFor(() => {
        expect(mockClipboardWriteText).toHaveBeenCalledWith('https://example.com/oauth/callback')
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.copySuccessfully',
      })
    })
  })

  describe('OAuth Authorization Flow', () => {
    it('should initiate OAuth when confirm button is clicked', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalled()
    })

    it('should open OAuth popup after successful configuration', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
        'https://oauth.example.com/authorize',
        expect.any(Function),
      )
    })

    it('should show success toast and close modal when OAuth callback succeeds', async () => {
      const mockOnOpenChange = vi.fn()
      const mockShowOAuthCreateModal = vi.fn()

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback({ success: true })
      })

      render(
        <OAuthClientSettingsModal
          {...defaultProps}
          onOpenChange={mockOnOpenChange}
          showOAuthCreateModal={mockShowOAuthCreateModal}
        />,
      )

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.authorization.authSuccess',
      })
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })

    it('should show error toast when OAuth initiation fails', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockRejectedValue(new Error('OAuth failed'))

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'OAuth failed',
      })
    })
  })

  describe('Save Only Flow', () => {
    it('should save configuration without authorization when cancel button is clicked', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'test-provider',
          enabled: false,
        }),
      )
    })

    it('should show success toast when save only succeeds', async () => {
      const mockOnOpenChange = vi.fn()
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} onOpenChange={mockOnOpenChange} />)

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.save.success',
      })
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('Remove OAuth Configuration', () => {
    it('should call deleteOAuth when remove button is clicked', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      const removeButton = screen.getByText('common.operation.remove')
      await act(async () => {
        fireEvent.click(removeButton)
      })

      expect(mockDeleteOAuth).toHaveBeenCalledWith('test-provider')
    })

    it('should show success toast when remove succeeds', async () => {
      const mockOnOpenChange = vi.fn()
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockResolvedValue(undefined)

      render(
        <OAuthClientSettingsModal
          {...defaultProps}
          oauthConfig={configWithCustomEnabled}
          onOpenChange={mockOnOpenChange}
        />,
      )

      const removeButton = screen.getByText('common.operation.remove')
      await act(async () => {
        fireEvent.click(removeButton)
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.remove.success',
      })
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })

    it('should show error toast when remove fails', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockRejectedValue(new Error('Delete failed'))

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      const removeButton = screen.getByText('common.operation.remove')
      await act(async () => {
        fireEvent.click(removeButton)
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Delete failed',
      })
    })
  })

  describe('Modal Actions', () => {
    it('should call onOpenChange when close button is clicked', async () => {
      const user = userEvent.setup()
      const mockOnOpenChange = vi.fn()
      render(<OAuthClientSettingsModal {...defaultProps} onOpenChange={mockOnOpenChange} />)

      await user.click(getCloseButton())

      expect(mockOnOpenChange.mock.calls[0]?.[0]).toBe(false)
    })

    it('should call onOpenChange when cancel button is clicked', async () => {
      const mockOnOpenChange = vi.fn()
      render(<OAuthClientSettingsModal {...defaultProps} onOpenChange={mockOnOpenChange} />)

      await act(async () => {
        fireEvent.click(getCancelButton())
      })

      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('Button Text States', () => {
    it('should show default button text initially', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(getConfirmButton()).toHaveTextContent('plugin.auth.saveAndAuth')
    })

    it('should show save only button text', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(getSaveOnlyButton()).toHaveTextContent('plugin.auth.saveOnly')
    })
  })

  describe('OAuth Client Schema', () => {
    it('should populate form with existing params values', () => {
      const configWithParams = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: {
          client_id: 'existing-client-id',
          client_secret: 'existing-client-secret',
        },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithParams} />)

      const clientIdInput = screen.getByTestId('form-field-client_id') as HTMLInputElement
      const clientSecretInput = screen.getByTestId('form-field-client_secret') as HTMLInputElement

      expect(clientIdInput.defaultValue).toBe('existing-client-id')
      expect(clientSecretInput.defaultValue).toBe('existing-client-secret')
    })

    it('should handle empty oauth_client_schema', () => {
      const configWithEmptySchema = createMockOAuthConfig({
        system_configured: false,
        oauth_client_schema: [],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithEmptySchema} />)

      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined oauthConfig', () => {
      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={undefined} />)

      expect(getDialog()).toBeInTheDocument()
    })

    it('should handle missing provider', () => {
      const detailWithoutProvider = createMockPluginDetail({ provider: '' })
      mockUsePluginStore.mockReturnValue(detailWithoutProvider)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(getDialog()).toBeInTheDocument()
    })
  })

  describe('Authorization Status Polling', () => {
    it('should initiate polling setup after OAuth starts', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      // Verify OAuth flow was initiated
      expect(mockInitiateOAuth).toHaveBeenCalledWith('test-provider')
    })

    it('should continue polling when verifyBuilder returns an error', async () => {
      vi.useFakeTimers()
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockRejectedValue(new Error('Verify failed'))

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(mockVerifyBuilder).toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('Verify failed')
      expect(mockToastNotify).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))

      // Should still be in pending state (polling continues)
      expect(getConfirmButton()).toHaveTextContent('pluginTrigger.modal.common.authorizing')

      vi.useRealTimers()
    })
  })

  describe('getErrorMessage helper', () => {
    it('should extract error message from Error object', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockRejectedValue(new Error('Custom error message'))

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Custom error message',
      })
    })

    it('should extract the backend message from an API error', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockRejectedValue(
        createHttpError(new Response(null, { status: 503 }), { message: 'Object error message' }),
      )

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Object error message',
      })
    })

    it('should use fallback message when error has no message', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockRejectedValue({})

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'api.actionFailed',
      })
    })

    it('should use fallback when error.message is not a string', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockRejectedValue({ message: 123 })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'api.actionFailed',
      })
    })

    it('should use fallback when error.message is empty string', async () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockRejectedValue({ message: '' })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      await act(async () => {
        fireEvent.click(screen.getByText('common.operation.remove'))
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'api.actionFailed',
      })
    })
  })

  describe('OAuth callback edge cases', () => {
    it('should not show success toast when OAuth callback returns falsy data', async () => {
      const mockOnOpenChange = vi.fn()
      const mockShowOAuthCreateModal = vi.fn()

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback(null)
      })

      render(
        <OAuthClientSettingsModal
          {...defaultProps}
          onOpenChange={mockOnOpenChange}
          showOAuthCreateModal={mockShowOAuthCreateModal}
        />,
      )

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      // Should not show success toast or call callbacks
      expect(mockToastNotify).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: 'pluginTrigger.modal.oauth.authorization.authSuccess' }),
      )
      expect(mockShowOAuthCreateModal).not.toHaveBeenCalled()
    })
  })

  describe('Custom Client Type Save Flow', () => {
    it('should send enabled: true when custom client type is selected', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom
      const customCard = screen
        .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
        .closest('div')
      await act(async () => {
        fireEvent.click(customCard!)
      })

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
        }),
      )
    })

    it('should send enabled: false when default client type is selected', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Default is already selected
      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
        }),
      )
    })
  })

  describe('OAuth Client Schema Default Values', () => {
    it('should set default values from params to schema', () => {
      const configWithParams = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: {
          client_id: 'my-client-id',
          client_secret: 'my-client-secret',
        },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithParams} />)

      const clientIdInput = screen.getByTestId('form-field-client_id') as HTMLInputElement
      const clientSecretInput = screen.getByTestId('form-field-client_secret') as HTMLInputElement

      expect(clientIdInput.defaultValue).toBe('my-client-id')
      expect(clientSecretInput.defaultValue).toBe('my-client-secret')
    })

    it('should return empty array when oauth_client_schema is empty', () => {
      const configWithEmptySchema = createMockOAuthConfig({
        system_configured: false,
        oauth_client_schema: [],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithEmptySchema} />)

      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
    })

    it('should skip setting default when schema name is not in params', () => {
      const configWithPartialParams = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: {
          client_id: 'my-client-id',
          client_secret: '', // empty value - will not be set as default
        },
        oauth_client_schema: [
          {
            name: 'client_id',
            type: 'text-input' as unknown,
            required: true,
            label: { 'en-US': 'Client ID' } as unknown,
          },
          {
            name: 'client_secret',
            type: 'secret-input' as unknown,
            required: true,
            label: { 'en-US': 'Client Secret' } as unknown,
          },
          {
            name: 'extra_param',
            type: 'text-input' as unknown,
            required: false,
            label: { 'en-US': 'Extra Param' } as unknown,
          },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithPartialParams} />)

      const clientIdInput = screen.getByTestId('form-field-client_id') as HTMLInputElement
      expect(clientIdInput.defaultValue).toBe('my-client-id')

      // client_secret should have empty default since value is empty
      const clientSecretInput = screen.getByTestId('form-field-client_secret') as HTMLInputElement
      expect(clientSecretInput.defaultValue).toBe('')
    })
  })

  describe('Confirm Button Text States', () => {
    it('should show saveAndAuth text by default', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(getConfirmButton()).toHaveTextContent('plugin.auth.saveAndAuth')
    })

    it('should show authorizing text when authorization is pending', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockReturnValue(new Promise(() => {}))

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      expect(getConfirmButton()).toHaveTextContent('pluginTrigger.modal.common.authorizing')
    })
  })

  describe('Authorization Failed Status', () => {
    it('should set authorization status to Failed when OAuth initiation fails', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockRejectedValue(new Error('OAuth failed'))

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      // After failure, button text should return to default
      expect(getConfirmButton()).toHaveTextContent('plugin.auth.saveAndAuth')
    })
  })

  describe('Redirect URI Display', () => {
    it('should not show redirect URI info when redirect_uri is empty', () => {
      const configWithEmptyRedirectUri = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        redirect_uri: '',
      })

      render(
        <OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithEmptyRedirectUri} />,
      )

      expect(screen.queryByText('pluginTrigger.modal.oauthRedirectInfo')).not.toBeInTheDocument()
    })

    it('should show redirect URI info when custom type and redirect_uri exists', () => {
      const configWithRedirectUri = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        redirect_uri: 'https://my-app.com/oauth/callback',
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithRedirectUri} />)

      expect(screen.getByText('pluginTrigger.modal.oauthRedirectInfo')).toBeInTheDocument()
      expect(screen.getByText('https://my-app.com/oauth/callback')).toBeInTheDocument()
    })
  })

  describe('Remove Button Visibility', () => {
    it('should not show remove button when custom_enabled is false', () => {
      const configWithCustomDisabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: false,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomDisabled} />)

      expect(screen.queryByText('common.operation.remove')).not.toBeInTheDocument()
    })

    it('should not show remove button when default client type is selected', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: true,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      // Default is selected by default when system_configured is true
      expect(screen.queryByText('common.operation.remove')).not.toBeInTheDocument()
    })
  })

  describe('OAuth Client Title', () => {
    it('should render client type title', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(
        screen.getByText('pluginTrigger.subscription.addType.options.oauth.clientTitle'),
      ).toBeInTheDocument()
    })
  })

  describe('Form Validation on Custom Save', () => {
    it('should not call configureOAuth when form validation fails', async () => {
      setMockFormValues({
        values: { client_id: '', client_secret: '' },
        isCheckValidated: false,
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      const customCard = screen
        .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
        .closest('div')!
      await act(async () => {
        fireEvent.click(customCard)
      })

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      // Should not call configureOAuth because form validation failed
      expect(mockConfigureOAuth).not.toHaveBeenCalled()
    })
  })

  describe('Client Params Hidden Value Transform', () => {
    it('should transform client_id to hidden when unchanged', async () => {
      setMockFormValues({
        values: { client_id: 'default-client-id', client_secret: 'new-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      await act(async () => {
        fireEvent.click(
          screen
            .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
            .closest('div')!,
        )
      })

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: '[__HIDDEN__]',
            client_secret: 'new-secret',
          }),
        }),
      )
    })

    it('should transform client_secret to hidden when unchanged', async () => {
      setMockFormValues({
        values: { client_id: 'new-id', client_secret: 'default-client-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      await act(async () => {
        fireEvent.click(
          screen
            .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
            .closest('div')!,
        )
      })

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: 'new-id',
            client_secret: '[__HIDDEN__]',
          }),
        }),
      )
    })

    it('should transform both client_id and client_secret to hidden when both unchanged', async () => {
      setMockFormValues({
        values: { client_id: 'default-client-id', client_secret: 'default-client-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      await act(async () => {
        fireEvent.click(
          screen
            .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
            .closest('div')!,
        )
      })

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: '[__HIDDEN__]',
            client_secret: '[__HIDDEN__]',
          }),
        }),
      )
    })

    it('should send new values when both changed', async () => {
      setMockFormValues({
        values: { client_id: 'new-client-id', client_secret: 'new-client-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockResolvedValue(undefined)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      await act(async () => {
        fireEvent.click(
          screen
            .getByText('pluginTrigger.subscription.addType.options.oauth.custom')
            .closest('div')!,
        )
      })

      await act(async () => {
        fireEvent.click(getSaveOnlyButton())
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: 'new-client-id',
            client_secret: 'new-client-secret',
          }),
        }),
      )
    })
  })

  describe('Polling Verification Success', () => {
    it('should call verifyBuilder and update status on success', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockResolvedValue({ verified: true })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      // Advance timer to trigger polling
      await vi.advanceTimersByTimeAsync(3000)

      expect(mockVerifyBuilder).toHaveBeenCalled()

      // Button text should show waitingJump after verified
      await waitFor(() => {
        expect(getConfirmButton()).toHaveTextContent(
          'pluginTrigger.modal.oauth.authorization.waitingJump',
        )
      })

      vi.useRealTimers()
    })

    it('should continue polling when not verified', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockResolvedValue({ verified: false })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      await act(async () => {
        fireEvent.click(getConfirmButton())
      })

      // First poll
      await vi.advanceTimersByTimeAsync(3000)
      expect(mockVerifyBuilder).toHaveBeenCalledTimes(1)

      // Second poll
      await vi.advanceTimersByTimeAsync(3000)
      expect(mockVerifyBuilder).toHaveBeenCalledTimes(2)

      // Should still be in authorizing state
      expect(getConfirmButton()).toHaveTextContent('pluginTrigger.modal.common.authorizing')

      vi.useRealTimers()
    })
  })

  describe('OAuth Client Schema Params Fallback', () => {
    it('should handle schema when params is truthy but schema name not in params', () => {
      const configWithSchemaNotInParams = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: {
          client_id: 'test-id',
          client_secret: 'test-secret',
        },
        oauth_client_schema: [
          {
            name: 'client_id',
            type: 'text-input' as unknown,
            required: true,
            label: { 'en-US': 'Client ID' } as unknown,
          },
          {
            name: 'client_secret',
            type: 'secret-input' as unknown,
            required: true,
            label: { 'en-US': 'Client Secret' } as unknown,
          },
          {
            name: 'extra_field',
            type: 'text-input' as unknown,
            required: false,
            label: { 'en-US': 'Extra' } as unknown,
          },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })

      render(
        <OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithSchemaNotInParams} />,
      )

      // extra_field should be rendered but without default value
      const extraInput = screen.getByTestId('form-field-extra_field') as HTMLInputElement
      expect(extraInput.defaultValue).toBe('')
    })

    it('should handle oauth_client_schema with undefined params', () => {
      const configWithUndefinedParams = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: undefined as unknown as TriggerOAuthConfig['params'],
        oauth_client_schema: [
          {
            name: 'client_id',
            type: 'text-input' as unknown,
            required: true,
            label: { 'en-US': 'Client ID' } as unknown,
          },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithUndefinedParams} />)

      // Form should not render because params is undefined (schema condition fails)
      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
    })

    it('should handle oauth_client_schema with null params', () => {
      const configWithNullParams = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: null as unknown as TriggerOAuthConfig['params'],
        oauth_client_schema: [
          {
            name: 'client_id',
            type: 'text-input' as unknown,
            required: true,
            label: { 'en-US': 'Client ID' } as unknown,
          },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithNullParams} />)

      // Form should not render because params is null
      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
    })
  })
})
