import type { TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'

// Import after mocks
import { OAuthClientSettingsModal } from './oauth-client'

// ============================================================================
// Type Definitions
// ============================================================================

type PluginDetail = {
  plugin_id: string
  provider: string
  name: string
}

// ============================================================================
// Mock Factory Functions
// ============================================================================

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
      { name: 'client_id', type: 'text-input' as unknown, required: true, label: { 'en-US': 'Client ID' } as unknown },
      { name: 'client_secret', type: 'secret-input' as unknown, required: true, label: { 'en-US': 'Client Secret' } as unknown },
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

function createMockSubscriptionBuilder(overrides: Partial<TriggerSubscriptionBuilder> = {}): TriggerSubscriptionBuilder {
  return {
    id: 'builder-123',
    name: 'Test Builder',
    provider: 'test-provider',
    credential_type: TriggerCredentialTypeEnum.Oauth2,
    credentials: {},
    endpoint: 'https://example.com/callback',
    parameters: {},
    properties: {},
    workflows_in_use: 0,
    ...overrides,
  }
}

// ============================================================================
// Mock Setup
// ============================================================================

// Mock plugin store
const mockPluginDetail = createMockPluginDetail()
const mockUsePluginStore = vi.fn(() => mockPluginDetail)
vi.mock('../../store', () => ({
  usePluginStore: () => mockUsePluginStore(),
}))

// Mock service hooks
const mockInitiateOAuth = vi.fn()
const mockVerifyBuilder = vi.fn()
const mockConfigureOAuth = vi.fn()
const mockDeleteOAuth = vi.fn()

vi.mock('@/service/use-triggers', () => ({
  useInitiateTriggerOAuth: () => ({
    mutate: mockInitiateOAuth,
  }),
  useVerifyAndUpdateTriggerSubscriptionBuilder: () => ({
    mutate: mockVerifyBuilder,
  }),
  useConfigureTriggerOAuth: () => ({
    mutate: mockConfigureOAuth,
  }),
  useDeleteTriggerOAuth: () => ({
    mutate: mockDeleteOAuth,
  }),
}))

// Mock OAuth popup
const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (url: string, callback: (data: unknown) => void) => mockOpenOAuthPopup(url, callback),
}))

// Mock toast
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (params: unknown) => mockToastNotify(params),
  },
}))

// Mock clipboard API
const mockClipboardWriteText = vi.fn()
Object.assign(navigator, {
  clipboard: {
    writeText: mockClipboardWriteText,
  },
})

// Mock Modal component
vi.mock('@/app/components/base/modal/modal', () => ({
  default: ({
    children,
    onClose,
    onConfirm,
    onCancel,
    title,
    confirmButtonText,
    cancelButtonText,
    footerSlot,
    onExtraButtonClick,
    extraButtonText,
  }: {
    children: React.ReactNode
    onClose: () => void
    onConfirm: () => void
    onCancel: () => void
    title: string
    confirmButtonText: string
    cancelButtonText?: string
    footerSlot?: React.ReactNode
    onExtraButtonClick?: () => void
    extraButtonText?: string
  }) => (
    <div data-testid="modal">
      <div data-testid="modal-title">{title}</div>
      <div data-testid="modal-content">{children}</div>
      <div data-testid="modal-footer">
        {footerSlot}
        {extraButtonText && (
          <button data-testid="modal-extra" onClick={onExtraButtonClick}>{extraButtonText}</button>
        )}
        {cancelButtonText && (
          <button data-testid="modal-cancel" onClick={onCancel}>{cancelButtonText}</button>
        )}
        <button data-testid="modal-confirm" onClick={onConfirm}>{confirmButtonText}</button>
        <button data-testid="modal-close" onClick={onClose}>Close</button>
      </div>
    </div>
  ),
}))

// Mock Button component
vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, variant, className }: {
    children: React.ReactNode
    onClick?: () => void
    variant?: string
    className?: string
  }) => (
    <button
      data-testid={`button-${variant || 'default'}`}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  ),
}))
// Configurable form mock values
let mockFormValues: { values: Record<string, string>, isCheckValidated: boolean } = {
  values: { client_id: 'test-client-id', client_secret: 'test-client-secret' },
  isCheckValidated: true,
}
const setMockFormValues = (values: typeof mockFormValues) => {
  mockFormValues = values
}

vi.mock('@/app/components/base/form/components/base', () => ({
  BaseForm: React.forwardRef((
    { formSchemas }: { formSchemas: Array<{ name: string, default?: string }> },
    ref: React.ForwardedRef<{ getFormValues: () => { values: Record<string, string>, isCheckValidated: boolean } }>,
  ) => {
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return (
      <div data-testid="base-form">
        {formSchemas.map(schema => (
          <input
            key={schema.name}
            data-testid={`form-field-${schema.name}`}
            name={schema.name}
            defaultValue={schema.default || ''}
          />
        ))}
      </div>
    )
  }),
}))

// Mock OptionCard component
vi.mock('@/app/components/workflow/nodes/_base/components/option-card', () => ({
  default: ({ title, onSelect, selected, className }: {
    title: string
    onSelect: () => void
    selected: boolean
    className?: string
  }) => (
    <div
      data-testid={`option-card-${title}`}
      onClick={onSelect}
      className={`${className} ${selected ? 'selected' : ''}`}
      data-selected={selected}
    >
      {title}
    </div>
  ),
}))

// ============================================================================
// Test Suites
// ============================================================================

describe('OAuthClientSettingsModal', () => {
  const defaultProps = {
    oauthConfig: createMockOAuthConfig(),
    onClose: vi.fn(),
    showOAuthCreateModal: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePluginStore.mockReturnValue(mockPluginDetail)
    mockClipboardWriteText.mockResolvedValue(undefined)
    // Reset form values to default
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

      expect(screen.getByTestId('modal-title')).toHaveTextContent('pluginTrigger.modal.oauth.title')
    })

    it('should render client type selector when system_configured is true', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.default')).toBeInTheDocument()
      expect(screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom')).toBeInTheDocument()
    })

    it('should not render client type selector when system_configured is false', () => {
      const configWithoutSystemConfigured = createMockOAuthConfig({
        system_configured: false,
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithoutSystemConfigured} />)

      expect(screen.queryByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.default')).not.toBeInTheDocument()
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

      const defaultCard = screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.default')
      expect(defaultCard).toHaveAttribute('data-selected', 'true')
    })

    it('should switch to Custom client type when Custom card is clicked', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      const customCard = screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom')
      fireEvent.click(customCard)

      expect(customCard).toHaveAttribute('data-selected', 'true')
    })

    it('should switch back to Default client type when Default card is clicked', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      const customCard = screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom')
      fireEvent.click(customCard)

      const defaultCard = screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.default')
      fireEvent.click(defaultCard)

      expect(defaultCard).toHaveAttribute('data-selected', 'true')
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
      fireEvent.click(copyButton)

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
    it('should initiate OAuth when confirm button is clicked', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(mockConfigureOAuth).toHaveBeenCalled()
    })

    it('should open OAuth popup after successful configuration', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
        'https://oauth.example.com/authorize',
        expect.any(Function),
      )
    })

    it('should show success toast and close modal when OAuth callback succeeds', () => {
      const mockOnClose = vi.fn()
      const mockShowOAuthCreateModal = vi.fn()

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        const builder = createMockSubscriptionBuilder()
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: builder,
        })
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback({ success: true })
      })

      render(
        <OAuthClientSettingsModal
          {...defaultProps}
          onClose={mockOnClose}
          showOAuthCreateModal={mockShowOAuthCreateModal}
        />,
      )

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.authorization.authSuccess',
      })
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should show error toast when OAuth initiation fails', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onError }) => {
        onError(new Error('OAuth failed'))
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'pluginTrigger.modal.oauth.authorization.authFailed',
      })
    })
  })

  describe('Save Only Flow', () => {
    it('should save configuration without authorization when cancel button is clicked', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'test-provider',
          enabled: false,
        }),
        expect.any(Object),
      )
    })

    it('should show success toast when save only succeeds', () => {
      const mockOnClose = vi.fn()
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.save.success',
      })
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Remove OAuth Configuration', () => {
    it('should call deleteOAuth when remove button is clicked', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      const removeButton = screen.getByText('common.operation.remove')
      fireEvent.click(removeButton)

      expect(mockDeleteOAuth).toHaveBeenCalledWith(
        'test-provider',
        expect.any(Object),
      )
    })

    it('should show success toast when remove succeeds', () => {
      const mockOnClose = vi.fn()
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess()
      })

      render(
        <OAuthClientSettingsModal
          {...defaultProps}
          oauthConfig={configWithCustomEnabled}
          onClose={mockOnClose}
        />,
      )

      const removeButton = screen.getByText('common.operation.remove')
      fireEvent.click(removeButton)

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.remove.success',
      })
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should show error toast when remove fails', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError(new Error('Delete failed'))
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      const removeButton = screen.getByText('common.operation.remove')
      fireEvent.click(removeButton)

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Delete failed',
      })
    })
  })

  describe('Modal Actions', () => {
    it('should call onClose when close button is clicked', () => {
      const mockOnClose = vi.fn()
      render(<OAuthClientSettingsModal {...defaultProps} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('modal-close'))

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should call onClose when extra button (cancel) is clicked', () => {
      const mockOnClose = vi.fn()
      render(<OAuthClientSettingsModal {...defaultProps} onClose={mockOnClose} />)

      fireEvent.click(screen.getByTestId('modal-extra'))

      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Button Text States', () => {
    it('should show default button text initially', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('plugin.auth.saveAndAuth')
    })

    it('should show save only button text', () => {
      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(screen.getByTestId('modal-cancel')).toHaveTextContent('plugin.auth.saveOnly')
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

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should handle missing provider', () => {
      const detailWithoutProvider = createMockPluginDetail({ provider: '' })
      mockUsePluginStore.mockReturnValue(detailWithoutProvider)

      render(<OAuthClientSettingsModal {...defaultProps} />)

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })
  })

  describe('Authorization Status Polling', () => {
    it('should initiate polling setup after OAuth starts', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // Verify OAuth flow was initiated
      expect(mockInitiateOAuth).toHaveBeenCalledWith(
        'test-provider',
        expect.any(Object),
      )
    })

    it('should continue polling when verifyBuilder returns an error', async () => {
      vi.useFakeTimers()
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onError }) => {
        onError(new Error('Verify failed'))
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      vi.advanceTimersByTime(3000)
      expect(mockVerifyBuilder).toHaveBeenCalled()

      // Should still be in pending state (polling continues)
      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.authorizing')

      vi.useRealTimers()
    })
  })

  describe('getErrorMessage helper', () => {
    it('should extract error message from Error object', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError(new Error('Custom error message'))
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      fireEvent.click(screen.getByText('common.operation.remove'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Custom error message',
      })
    })

    it('should extract error message from object with message property', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError({ message: 'Object error message' })
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      fireEvent.click(screen.getByText('common.operation.remove'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Object error message',
      })
    })

    it('should use fallback message when error has no message', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError({})
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      fireEvent.click(screen.getByText('common.operation.remove'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'pluginTrigger.modal.oauth.remove.failed',
      })
    })

    it('should use fallback when error.message is not a string', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError({ message: 123 })
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      fireEvent.click(screen.getByText('common.operation.remove'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'pluginTrigger.modal.oauth.remove.failed',
      })
    })

    it('should use fallback when error.message is empty string', () => {
      const configWithCustomEnabled = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        params: { client_id: 'test-id', client_secret: 'test-secret' },
      })

      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError({ message: '' })
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithCustomEnabled} />)

      fireEvent.click(screen.getByText('common.operation.remove'))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'pluginTrigger.modal.oauth.remove.failed',
      })
    })
  })

  describe('OAuth callback edge cases', () => {
    it('should not show success toast when OAuth callback returns falsy data', () => {
      const mockOnClose = vi.fn()
      const mockShowOAuthCreateModal = vi.fn()

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback(null)
      })

      render(
        <OAuthClientSettingsModal
          {...defaultProps}
          onClose={mockOnClose}
          showOAuthCreateModal={mockShowOAuthCreateModal}
        />,
      )

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // Should not show success toast or call callbacks
      expect(mockToastNotify).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: 'pluginTrigger.modal.oauth.authorization.authSuccess' }),
      )
      expect(mockShowOAuthCreateModal).not.toHaveBeenCalled()
    })
  })

  describe('Custom Client Type Save Flow', () => {
    it('should send enabled: true when custom client type is selected', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom
      const customCard = screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom')
      fireEvent.click(customCard)

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
        }),
        expect.any(Object),
      )
    })

    it('should send enabled: false when default client type is selected', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Default is already selected
      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
        }),
        expect.any(Object),
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
          { name: 'client_id', type: 'text-input' as unknown, required: true, label: { 'en-US': 'Client ID' } as unknown },
          { name: 'client_secret', type: 'secret-input' as unknown, required: true, label: { 'en-US': 'Client Secret' } as unknown },
          { name: 'extra_param', type: 'text-input' as unknown, required: false, label: { 'en-US': 'Extra Param' } as unknown },
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

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('plugin.auth.saveAndAuth')
    })

    it('should show authorizing text when authorization is pending', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation(() => {
        // Don't call callback - stays pending
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.authorizing')
    })
  })

  describe('Authorization Failed Status', () => {
    it('should set authorization status to Failed when OAuth initiation fails', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onError }) => {
        onError(new Error('OAuth failed'))
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // After failure, button text should return to default
      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('plugin.auth.saveAndAuth')
    })
  })

  describe('Redirect URI Display', () => {
    it('should not show redirect URI info when redirect_uri is empty', () => {
      const configWithEmptyRedirectUri = createMockOAuthConfig({
        system_configured: false,
        custom_enabled: true,
        redirect_uri: '',
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithEmptyRedirectUri} />)

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

      expect(screen.getByText('pluginTrigger.subscription.addType.options.oauth.clientTitle')).toBeInTheDocument()
    })
  })

  describe('Form Validation on Custom Save', () => {
    it('should not call configureOAuth when form validation fails', () => {
      setMockFormValues({
        values: { client_id: '', client_secret: '' },
        isCheckValidated: false,
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      const customCard = screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom')
      fireEvent.click(customCard)

      fireEvent.click(screen.getByTestId('modal-cancel'))

      // Should not call configureOAuth because form validation failed
      expect(mockConfigureOAuth).not.toHaveBeenCalled()
    })
  })

  describe('Client Params Hidden Value Transform', () => {
    it('should transform client_id to hidden when unchanged', () => {
      setMockFormValues({
        values: { client_id: 'default-client-id', client_secret: 'new-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      fireEvent.click(screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom'))

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: '[__HIDDEN__]',
            client_secret: 'new-secret',
          }),
        }),
        expect.any(Object),
      )
    })

    it('should transform client_secret to hidden when unchanged', () => {
      setMockFormValues({
        values: { client_id: 'new-id', client_secret: 'default-client-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      fireEvent.click(screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom'))

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: 'new-id',
            client_secret: '[__HIDDEN__]',
          }),
        }),
        expect.any(Object),
      )
    })

    it('should transform both client_id and client_secret to hidden when both unchanged', () => {
      setMockFormValues({
        values: { client_id: 'default-client-id', client_secret: 'default-client-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      fireEvent.click(screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom'))

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: '[__HIDDEN__]',
            client_secret: '[__HIDDEN__]',
          }),
        }),
        expect.any(Object),
      )
    })

    it('should send new values when both changed', () => {
      setMockFormValues({
        values: { client_id: 'new-client-id', client_secret: 'new-client-secret' },
        isCheckValidated: true,
      })
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      // Switch to custom type
      fireEvent.click(screen.getByTestId('option-card-pluginTrigger.subscription.addType.options.oauth.custom'))

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          client_params: expect.objectContaining({
            client_id: 'new-client-id',
            client_secret: 'new-client-secret',
          }),
        }),
        expect.any(Object),
      )
    })
  })

  describe('Polling Verification Success', () => {
    it('should call verifyBuilder and update status on success', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onSuccess }) => {
        onSuccess({ verified: true })
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // Advance timer to trigger polling
      await vi.advanceTimersByTimeAsync(3000)

      expect(mockVerifyBuilder).toHaveBeenCalled()

      // Button text should show waitingJump after verified
      await waitFor(() => {
        expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.oauth.authorization.waitingJump')
      })

      vi.useRealTimers()
    })

    it('should continue polling when not verified', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => {
        onSuccess()
      })
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onSuccess }) => {
        onSuccess({ verified: false })
      })

      render(<OAuthClientSettingsModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('modal-confirm'))

      // First poll
      await vi.advanceTimersByTimeAsync(3000)
      expect(mockVerifyBuilder).toHaveBeenCalledTimes(1)

      // Second poll
      await vi.advanceTimersByTimeAsync(3000)
      expect(mockVerifyBuilder).toHaveBeenCalledTimes(2)

      // Should still be in authorizing state
      expect(screen.getByTestId('modal-confirm')).toHaveTextContent('pluginTrigger.modal.common.authorizing')

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
          { name: 'client_id', type: 'text-input' as unknown, required: true, label: { 'en-US': 'Client ID' } as unknown },
          { name: 'client_secret', type: 'secret-input' as unknown, required: true, label: { 'en-US': 'Client Secret' } as unknown },
          { name: 'extra_field', type: 'text-input' as unknown, required: false, label: { 'en-US': 'Extra' } as unknown },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithSchemaNotInParams} />)

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
          { name: 'client_id', type: 'text-input' as unknown, required: true, label: { 'en-US': 'Client ID' } as unknown },
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
          { name: 'client_id', type: 'text-input' as unknown, required: true, label: { 'en-US': 'Client ID' } as unknown },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })

      render(<OAuthClientSettingsModal {...defaultProps} oauthConfig={configWithNullParams} />)

      // Form should not render because params is null
      expect(screen.queryByTestId('base-form')).not.toBeInTheDocument()
    })
  })
})
