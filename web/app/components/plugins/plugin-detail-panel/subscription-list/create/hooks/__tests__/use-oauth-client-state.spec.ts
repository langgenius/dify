import type { TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import {
  AuthorizationStatusEnum,
  ClientTypeEnum,
  getErrorMessage,
  useOAuthClientState,
} from '../use-oauth-client-state'

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

const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (url: string, callback: (data: unknown) => void) => mockOpenOAuthPopup(url, callback),
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (params: unknown) => mockToastNotify(params),
  },
}))

// ============================================================================
// Test Suites
// ============================================================================

describe('getErrorMessage', () => {
  it('should extract message from Error instance', () => {
    const error = new Error('Test error message')
    expect(getErrorMessage(error, 'fallback')).toBe('Test error message')
  })

  it('should extract message from object with message property', () => {
    const error = { message: 'Object error message' }
    expect(getErrorMessage(error, 'fallback')).toBe('Object error message')
  })

  it('should return fallback when error is empty object', () => {
    expect(getErrorMessage({}, 'fallback')).toBe('fallback')
  })

  it('should return fallback when error.message is not a string', () => {
    expect(getErrorMessage({ message: 123 }, 'fallback')).toBe('fallback')
  })

  it('should return fallback when error.message is empty string', () => {
    expect(getErrorMessage({ message: '' }, 'fallback')).toBe('fallback')
  })

  it('should return fallback when error is null', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback')
  })

  it('should return fallback when error is undefined', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback')
  })

  it('should return fallback when error is a primitive', () => {
    expect(getErrorMessage('string error', 'fallback')).toBe('fallback')
    expect(getErrorMessage(123, 'fallback')).toBe('fallback')
  })
})

describe('useOAuthClientState', () => {
  const defaultParams = {
    oauthConfig: createMockOAuthConfig(),
    providerName: 'test-provider',
    onClose: vi.fn(),
    showOAuthCreateModal: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should default to Default client type when system_configured is true', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      expect(result.current.clientType).toBe(ClientTypeEnum.Default)
    })

    it('should default to Custom client type when system_configured is false', () => {
      const config = createMockOAuthConfig({ system_configured: false })
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: config,
      }))

      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)
    })

    it('should have undefined authorizationStatus initially', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      expect(result.current.authorizationStatus).toBeUndefined()
    })

    it('should provide clientFormRef', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      expect(result.current.clientFormRef).toBeDefined()
      expect(result.current.clientFormRef.current).toBeNull()
    })
  })

  describe('OAuth Client Schema', () => {
    it('should compute schema with default values from params', () => {
      const config = createMockOAuthConfig({
        params: {
          client_id: 'my-client-id',
          client_secret: 'my-secret',
        },
      })
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: config,
      }))

      expect(result.current.oauthClientSchema).toHaveLength(2)
      expect(result.current.oauthClientSchema[0].default).toBe('my-client-id')
      expect(result.current.oauthClientSchema[1].default).toBe('my-secret')
    })

    it('should return empty array when oauth_client_schema is empty', () => {
      const config = createMockOAuthConfig({
        oauth_client_schema: [],
      })
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: config,
      }))

      expect(result.current.oauthClientSchema).toEqual([])
    })

    it('should return empty array when params is undefined', () => {
      const config = createMockOAuthConfig({
        params: undefined as unknown as TriggerOAuthConfig['params'],
      })
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: config,
      }))

      expect(result.current.oauthClientSchema).toEqual([])
    })

    it('should preserve original schema default when param key not found', () => {
      const config = createMockOAuthConfig({
        params: {
          client_id: 'only-client-id',
          client_secret: '', // empty
        },
        oauth_client_schema: [
          { name: 'client_id', type: 'text-input' as unknown, required: true, label: {} as unknown, default: 'original-default' },
          { name: 'extra_field', type: 'text-input' as unknown, required: false, label: {} as unknown, default: 'extra-default' },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: config,
      }))

      // client_id should be overridden
      expect(result.current.oauthClientSchema[0].default).toBe('only-client-id')
      // extra_field should keep original default since key not in params
      expect(result.current.oauthClientSchema[1].default).toBe('extra-default')
    })
  })

  describe('Confirm Button Text', () => {
    it('should show saveAndAuth text by default', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      expect(result.current.confirmButtonText).toBe('plugin.auth.saveAndAuth')
    })

    it('should show authorizing text when status is Pending', async () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation(() => {
        // Don't resolve - stays pending
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      await waitFor(() => {
        expect(result.current.confirmButtonText).toBe('pluginTrigger.modal.common.authorizing')
      })
    })
  })

  describe('setClientType', () => {
    it('should update client type when called', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.setClientType(ClientTypeEnum.Custom)
      })

      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)
    })

    it('should toggle between client types', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.setClientType(ClientTypeEnum.Custom)
      })
      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)

      act(() => {
        result.current.setClientType(ClientTypeEnum.Default)
      })
      expect(result.current.clientType).toBe(ClientTypeEnum.Default)
    })
  })

  describe('handleRemove', () => {
    it('should call deleteOAuth with provider name', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleRemove()
      })

      expect(mockDeleteOAuth).toHaveBeenCalledWith(
        'test-provider',
        expect.any(Object),
      )
    })

    it('should call onClose and show success toast on success', () => {
      mockDeleteOAuth.mockImplementation((provider, { onSuccess }) => onSuccess())

      const onClose = vi.fn()
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        onClose,
      }))

      act(() => {
        result.current.handleRemove()
      })

      expect(onClose).toHaveBeenCalled()
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.remove.success',
      })
    })

    it('should show error toast with error message on failure', () => {
      mockDeleteOAuth.mockImplementation((provider, { onError }) => {
        onError(new Error('Delete failed'))
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleRemove()
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Delete failed',
      })
    })
  })

  describe('handleSave', () => {
    it('should call configureOAuth with enabled: false for Default type', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(false)
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'test-provider',
          enabled: false,
        }),
        expect.any(Object),
      )
    })

    it('should call configureOAuth with enabled: true for Custom type', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())

      const config = createMockOAuthConfig({ system_configured: false })
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: config,
      }))

      // Mock the form ref
      const mockFormRef = {
        getFormValues: () => ({
          values: { client_id: 'new-id', client_secret: 'new-secret' },
          isCheckValidated: true,
        }),
      }
      // @ts-expect-error - mocking ref
      result.current.clientFormRef.current = mockFormRef

      act(() => {
        result.current.handleSave(false)
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
        }),
        expect.any(Object),
      )
    })

    it('should show success toast and call onClose when needAuth is false', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      const onClose = vi.fn()

      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        onClose,
      }))

      act(() => {
        result.current.handleSave(false)
      })

      expect(onClose).toHaveBeenCalled()
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.save.success',
      })
    })

    it('should trigger authorization when needAuth is true', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      expect(mockInitiateOAuth).toHaveBeenCalledWith(
        'test-provider',
        expect.any(Object),
      )
    })
  })

  describe('handleAuthorization', () => {
    it('should set status to Pending and call initiateOAuth', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation(() => {})

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Pending)
      expect(mockInitiateOAuth).toHaveBeenCalled()
    })

    it('should open OAuth popup on success', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
        'https://oauth.example.com/authorize',
        expect.any(Function),
      )
    })

    it('should set status to Failed and show error toast on error', () => {
      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onError }) => {
        onError(new Error('OAuth failed'))
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Failed)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'pluginTrigger.modal.oauth.authorization.authFailed',
      })
    })

    it('should call onClose and showOAuthCreateModal on callback success', () => {
      const onClose = vi.fn()
      const showOAuthCreateModal = vi.fn()
      const builder = createMockSubscriptionBuilder()

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: builder,
        })
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback({ success: true })
      })

      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        onClose,
        showOAuthCreateModal,
      }))

      act(() => {
        result.current.handleSave(true)
      })

      expect(onClose).toHaveBeenCalled()
      expect(showOAuthCreateModal).toHaveBeenCalledWith(builder)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.authorization.authSuccess',
      })
    })

    it('should not call callbacks when OAuth callback returns falsy', () => {
      const onClose = vi.fn()
      const showOAuthCreateModal = vi.fn()

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback(null)
      })

      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        onClose,
        showOAuthCreateModal,
      }))

      act(() => {
        result.current.handleSave(true)
      })

      expect(onClose).not.toHaveBeenCalled()
      expect(showOAuthCreateModal).not.toHaveBeenCalled()
    })
  })

  describe('Polling Effect', () => {
    it('should start polling after authorization starts', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onSuccess }) => {
        onSuccess({ verified: false })
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      // Advance timer to trigger first poll
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      expect(mockVerifyBuilder).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should set status to Success when verified', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onSuccess }) => {
        onSuccess({ verified: true })
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      await waitFor(() => {
        expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Success)
      })

      vi.useRealTimers()
    })

    it('should continue polling on error', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onError }) => {
        onError(new Error('Verify failed'))
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      expect(mockVerifyBuilder).toHaveBeenCalled()
      // Status should still be Pending
      expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Pending)

      vi.useRealTimers()
    })

    it('should stop polling when verified', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockImplementation((params, { onSuccess }) => onSuccess())
      mockInitiateOAuth.mockImplementation((provider, { onSuccess }) => {
        onSuccess({
          authorization_url: 'https://oauth.example.com/authorize',
          subscription_builder: createMockSubscriptionBuilder(),
        })
      })
      mockVerifyBuilder.mockImplementation((params, { onSuccess }) => {
        onSuccess({ verified: true })
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      act(() => {
        result.current.handleSave(true)
      })

      // First poll - should verify
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      expect(mockVerifyBuilder).toHaveBeenCalledTimes(1)

      // Second poll - should not happen as interval is cleared
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      // Still only 1 call because polling stopped
      expect(mockVerifyBuilder).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined oauthConfig', () => {
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        oauthConfig: undefined,
      }))

      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)
      expect(result.current.oauthClientSchema).toEqual([])
    })

    it('should handle empty providerName', () => {
      const { result } = renderHook(() => useOAuthClientState({
        ...defaultParams,
        providerName: '',
      }))

      // Should not throw
      expect(result.current.clientType).toBe(ClientTypeEnum.Default)
    })
  })
})

describe('Enum Exports', () => {
  it('should export AuthorizationStatusEnum', () => {
    expect(AuthorizationStatusEnum.Pending).toBe('pending')
    expect(AuthorizationStatusEnum.Success).toBe('success')
    expect(AuthorizationStatusEnum.Failed).toBe('failed')
  })

  it('should export ClientTypeEnum', () => {
    expect(ClientTypeEnum.Default).toBe('default')
    expect(ClientTypeEnum.Custom).toBe('custom')
  })
})
