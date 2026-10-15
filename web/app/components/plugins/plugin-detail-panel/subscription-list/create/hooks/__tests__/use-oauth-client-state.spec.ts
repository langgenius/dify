import type {
  TriggerOAuthConfig,
  TriggerSubscriptionBuilder,
} from '@/app/components/workflow/block-selector/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { createHttpError } from '@/service/http-error'
import {
  AuthorizationStatusEnum,
  ClientTypeEnum,
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

// ============================================================================
// Mock Setup
// ============================================================================

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

// ============================================================================
// Test Suites
// ============================================================================

describe('useOAuthClientState', () => {
  const defaultParams = {
    oauthConfig: createMockOAuthConfig(),
    providerName: 'test-provider',
    onOpenChange: vi.fn(),
    showOAuthCreateModal: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockInitiateOAuth.mockReset().mockReturnValue(new Promise(() => {}))
    mockConfigureOAuth.mockReset().mockResolvedValue(undefined)
    mockDeleteOAuth.mockReset().mockResolvedValue(undefined)
    mockVerifyBuilder.mockReset().mockResolvedValue({ verified: false })
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
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: config,
        }),
      )

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
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: config,
        }),
      )

      expect(result.current.oauthClientSchema).toHaveLength(2)
      expect(result.current.oauthClientSchema[0]!.default).toBe('my-client-id')
      expect(result.current.oauthClientSchema[1]!.default).toBe('my-secret')
    })

    it('should return empty array when oauth_client_schema is empty', () => {
      const config = createMockOAuthConfig({
        oauth_client_schema: [],
      })
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: config,
        }),
      )

      expect(result.current.oauthClientSchema).toEqual([])
    })

    it('should return empty array when params is undefined', () => {
      const config = createMockOAuthConfig({
        params: undefined as unknown as TriggerOAuthConfig['params'],
      })
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: config,
        }),
      )

      expect(result.current.oauthClientSchema).toEqual([])
    })

    it('should preserve original schema default when param key not found', () => {
      const config = createMockOAuthConfig({
        params: {
          client_id: 'only-client-id',
          client_secret: '', // empty
        },
        oauth_client_schema: [
          {
            name: 'client_id',
            type: 'text-input' as unknown,
            required: true,
            label: {} as unknown,
            default: 'original-default',
          },
          {
            name: 'extra_field',
            type: 'text-input' as unknown,
            required: false,
            label: {} as unknown,
            default: 'extra-default',
          },
        ] as TriggerOAuthConfig['oauth_client_schema'],
      })
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: config,
        }),
      )

      // client_id should be overridden
      expect(result.current.oauthClientSchema[0]!.default).toBe('only-client-id')
      // extra_field should keep original default since key not in params
      expect(result.current.oauthClientSchema[1]!.default).toBe('extra-default')
    })
  })

  describe('Confirm Button Text', () => {
    it('should show saveAndAuth text by default', () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      expect(result.current.confirmButtonText).toBe('plugin.auth.saveAndAuth')
    })

    it('should show authorizing text when status is Pending', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockReturnValue(new Promise(() => {}))

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(true)
      })

      await waitFor(() => {
        expect(result.current.confirmButtonText).toBe('pluginTrigger.modal.common.authorizing')
      })
    })
  })

  describe('setClientType', () => {
    it('should update client type when called', async () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.setClientType(ClientTypeEnum.Custom)
      })

      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)
    })

    it('should toggle between client types', async () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.setClientType(ClientTypeEnum.Custom)
      })
      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)

      await act(async () => {
        result.current.setClientType(ClientTypeEnum.Default)
      })
      expect(result.current.clientType).toBe(ClientTypeEnum.Default)
    })
  })

  describe('handleRemove', () => {
    it('should call deleteOAuth with provider name', async () => {
      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleRemove()
      })

      expect(mockDeleteOAuth).toHaveBeenCalledWith('test-provider')
    })

    it('should call onOpenChange and show success toast on success', async () => {
      mockDeleteOAuth.mockResolvedValue(undefined)

      const onOpenChange = vi.fn()
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          onOpenChange,
        }),
      )

      await act(async () => {
        result.current.handleRemove()
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.remove.success',
      })
    })

    it('shows the HTTP error message when removal fails', async () => {
      const error = createHttpError(new Response(null, { status: 403 }), {
        message: 'Delete failed',
      })
      mockDeleteOAuth.mockRejectedValue(error)

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleRemove()
      })

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Delete failed',
      })
    })
  })

  describe('handleSave', () => {
    it('should call configureOAuth with enabled: false for Default type', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(false)
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'test-provider',
          enabled: false,
        }),
      )
    })

    it('should call configureOAuth with enabled: true for Custom type', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)

      const config = createMockOAuthConfig({ system_configured: false })
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: config,
        }),
      )

      // Mock the form ref
      const mockFormRef = {
        getFormValues: () => ({
          values: { client_id: 'new-id', client_secret: 'new-secret' },
          isCheckValidated: true,
        }),
      }
      // @ts-expect-error - mocking ref
      result.current.clientFormRef.current = mockFormRef

      await act(async () => {
        result.current.handleSave(false)
      })

      expect(mockConfigureOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
        }),
      )
    })

    it('should show success toast and call onOpenChange when needAuth is false', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      const onOpenChange = vi.fn()

      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          onOpenChange,
        }),
      )

      await act(async () => {
        result.current.handleSave(false)
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.save.success',
      })
    })

    it('should trigger authorization when needAuth is true', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(true)
      })

      expect(mockInitiateOAuth).toHaveBeenCalledWith('test-provider')
    })
  })

  describe('handleAuthorization', () => {
    it('should set status to Pending and call initiateOAuth', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockReturnValue(new Promise(() => {}))

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(true)
      })

      expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Pending)
      expect(mockInitiateOAuth).toHaveBeenCalled()
    })

    it('should open OAuth popup on success', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(true)
      })

      expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
        'https://oauth.example.com/authorize',
        expect.any(Function),
      )
    })

    it('should set status to Failed and show error toast on error', async () => {
      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockRejectedValue(new Error('OAuth failed'))

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(true)
      })

      expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Failed)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'OAuth failed',
      })
    })

    it('should call onOpenChange and showOAuthCreateModal on callback success', async () => {
      const onOpenChange = vi.fn()
      const showOAuthCreateModal = vi.fn()
      const builder = createMockSubscriptionBuilder()

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: builder,
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback({ success: true })
      })

      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          onOpenChange,
          showOAuthCreateModal,
        }),
      )

      await act(async () => {
        result.current.handleSave(true)
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(showOAuthCreateModal).toHaveBeenCalledWith(builder)
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'pluginTrigger.modal.oauth.authorization.authSuccess',
      })
    })

    it('should not call callbacks when OAuth callback returns falsy', async () => {
      const onOpenChange = vi.fn()
      const showOAuthCreateModal = vi.fn()

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback(null)
      })

      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          onOpenChange,
          showOAuthCreateModal,
        }),
      )

      await act(async () => {
        result.current.handleSave(true)
      })

      expect(onOpenChange).not.toHaveBeenCalled()
      expect(showOAuthCreateModal).not.toHaveBeenCalled()
    })
  })

  describe('Polling Effect', () => {
    it('should start polling after authorization starts', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockResolvedValue({ verified: false })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
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

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockResolvedValue({ verified: true })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
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

    it('shows verification failure while retaining polling and clears it on recovery', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockRejectedValue(new Error('Verify failed'))

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
        result.current.handleSave(true)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(mockVerifyBuilder).toHaveBeenCalled()
      // Status should still be Pending
      expect(result.current.authorizationStatus).toBe(AuthorizationStatusEnum.Pending)

      expect(result.current.verificationError).toEqual(new Error('Verify failed'))
      expect(mockToastNotify).not.toHaveBeenCalled()
      mockVerifyBuilder.mockResolvedValue({ verified: false })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(mockVerifyBuilder).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(result.current.verificationError).toBeNull())
      vi.useRealTimers()
    })

    it('should stop polling when verified', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockConfigureOAuth.mockResolvedValue(undefined)
      mockInitiateOAuth.mockResolvedValue({
        authorization_url: 'https://oauth.example.com/authorize',
        subscription_builder: createMockSubscriptionBuilder(),
      })
      mockVerifyBuilder.mockResolvedValue({ verified: true })

      const { result } = renderHook(() => useOAuthClientState(defaultParams))

      await act(async () => {
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
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          oauthConfig: undefined,
        }),
      )

      expect(result.current.clientType).toBe(ClientTypeEnum.Custom)
      expect(result.current.oauthClientSchema).toEqual([])
    })

    it('should handle empty providerName', () => {
      const { result } = renderHook(() =>
        useOAuthClientState({
          ...defaultParams,
          providerName: '',
        }),
      )

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
