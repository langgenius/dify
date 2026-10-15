import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { ApiKeyStep, useCommonModalState } from '../use-common-modal-state'

type MockPluginDetail = {
  plugin_id: string
  provider: string
  name: string
  declaration: {
    trigger: {
      subscription_schema: Array<{ name: string; type: string; description?: string }>
      subscription_constructor: {
        credentials_schema: Array<{ name: string; type: string; help?: string }>
        parameters: Array<{ name: string; type: string }>
      }
    }
  }
}

const createMockBuilder = (
  overrides: Partial<TriggerSubscriptionBuilder> = {},
): TriggerSubscriptionBuilder => ({
  id: 'builder-1',
  name: 'builder',
  provider: 'provider-a',
  credential_type: TriggerCredentialType.ApiKey,
  credentials: {},
  endpoint: 'https://example.com/callback',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
  ...overrides,
})

const mockDetail: MockPluginDetail = {
  plugin_id: 'plugin-id',
  provider: 'provider-a',
  name: 'Plugin A',
  declaration: {
    trigger: {
      subscription_schema: [{ name: 'webhook_url', type: 'string', description: 'Webhook URL' }],
      subscription_constructor: {
        credentials_schema: [{ name: 'api_key', type: 'string', help: 'API key help' }],
        parameters: [{ name: 'repo_name', type: 'string' }],
      },
    },
  },
}

const mockUsePluginStore = vi.fn(() => mockDetail)
vi.mock('../../../../store', () => ({
  usePluginStore: () => mockUsePluginStore(),
}))

const mockRefetch = vi.fn()
vi.mock('../../../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

const mockVerifyCredentials = vi.fn()
const mockCreateBuilder = vi.fn()
const mockBuildSubscription = vi.fn()
const mockUpdateBuilder = vi.fn()

vi.mock('@/service/use-triggers', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const { createTestQueryClient } = await import('@/test/query-client')
  const mutationClient = createTestQueryClient()
  return {
    useVerifyAndUpdateTriggerSubscriptionBuilder: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockVerifyCredentials(variables), ...options },
        mutationClient,
      ),
    useCreateTriggerSubscriptionBuilder: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockCreateBuilder(variables), ...options },
        mutationClient,
      ),
    useBuildTriggerSubscription: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockBuildSubscription(variables), ...options },
        mutationClient,
      ),
    useUpdateTriggerSubscriptionBuilder: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockUpdateBuilder(variables), ...options },
        mutationClient,
      ),
    useTriggerSubscriptionBuilderLogs: () => ({
      data: { logs: [] },
    }),
  }
})

const mockToastNotify = vi.fn()
vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
  },
}))

const mockParsePluginErrorMessage = vi.fn().mockReturnValue(null)
vi.mock('@/utils/error-parser', () => ({
  parsePluginErrorMessage: (...args: unknown[]) => mockParsePluginErrorMessage(...args),
}))

vi.mock('@/utils/urlValidation', () => ({
  isPrivateOrLocalAddress: vi.fn().mockReturnValue(false),
}))

const createFormRef = ({
  values = {},
  isCheckValidated = true,
}: {
  values?: Record<string, unknown>
  isCheckValidated?: boolean
} = {}): FormRefObject =>
  ({
    getFormValues: vi.fn().mockReturnValue({ values, isCheckValidated }),
    setFields: vi.fn(),
    getForm: vi.fn().mockReturnValue({
      setFieldValue: vi.fn(),
    }),
  }) as unknown as FormRefObject

describe('useCommonModalState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateBuilder.mockResolvedValue({
      subscription_builder: createMockBuilder(),
    })
  })

  it('should initialize api key builders and expose verify step state', async () => {
    const { result } = renderHook(() =>
      useCommonModalState({
        createType: SupportedCreationMethods.APIKEY,
        onClose: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(result.current.subscriptionBuilder?.id).toBe('builder-1')
    })

    expect(mockCreateBuilder).toHaveBeenCalledWith({
      provider: 'provider-a',
      credential_type: TriggerCredentialType.ApiKey,
    })
    expect(result.current.currentStep).toBe(ApiKeyStep.Verify)
    expect(result.current.apiKeyCredentialsSchema[0]).toMatchObject({
      name: 'api_key',
      tooltip: 'API key help',
    })
  })

  it('should verify credentials and advance to configuration step', async () => {
    mockVerifyCredentials.mockResolvedValue(undefined)

    const builder = createMockBuilder()
    const { result } = renderHook(() =>
      useCommonModalState({
        createType: SupportedCreationMethods.APIKEY,
        builder,
        onClose: vi.fn(),
      }),
    )

    const credentialsFormRef = result.current.formRefs.apiKeyCredentialsFormRef as {
      current: FormRefObject | null
    }
    credentialsFormRef.current = createFormRef({
      values: { api_key: 'secret' },
    })

    await act(async () => {
      result.current.handleVerify()
    })

    expect(mockVerifyCredentials).toHaveBeenCalledWith({
      provider: 'provider-a',
      subscriptionBuilderId: builder.id,
      credentials: { api_key: 'secret' },
    })
    expect(result.current.currentStep).toBe(ApiKeyStep.Configuration)
    expect(mockToastNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
      }),
    )
  })

  it('should build subscriptions with validated automatic parameters', async () => {
    const onClose = vi.fn()
    const builder = createMockBuilder()
    const { result } = renderHook(() =>
      useCommonModalState({
        createType: SupportedCreationMethods.APIKEY,
        builder,
        onClose,
      }),
    )

    const subscriptionFormRef = result.current.formRefs.subscriptionFormRef as {
      current: FormRefObject | null
    }
    const autoParamsFormRef = result.current.formRefs.autoCommonParametersFormRef as {
      current: FormRefObject | null
    }

    subscriptionFormRef.current = createFormRef({
      values: { subscription_name: 'Subscription A' },
    })
    autoParamsFormRef.current = createFormRef({
      values: { repo_name: 'repo-a' },
    })

    await act(async () => {
      result.current.handleCreate()
    })

    expect(mockBuildSubscription).toHaveBeenCalledWith({
      provider: 'provider-a',
      subscriptionBuilderId: builder.id,
      name: 'Subscription A',
      parameters: { repo_name: 'repo-a' },
    })
  })

  it('should debounce manual property updates', async () => {
    vi.useFakeTimers()

    const builder = createMockBuilder({
      credential_type: TriggerCredentialType.Unauthorized,
    })
    const { result } = renderHook(() =>
      useCommonModalState({
        createType: SupportedCreationMethods.MANUAL,
        builder,
        onClose: vi.fn(),
      }),
    )

    const manualFormRef = result.current.formRefs.manualPropertiesFormRef as {
      current: FormRefObject | null
    }
    manualFormRef.current = createFormRef({
      values: { webhook_url: 'https://hook.example.com' },
      isCheckValidated: true,
    })

    await act(async () => {
      result.current.handleManualPropertiesChange()
      vi.advanceTimersByTime(500)
    })

    expect(mockUpdateBuilder).toHaveBeenCalledWith({
      provider: 'provider-a',
      subscriptionBuilderId: builder.id,
      properties: { webhook_url: 'https://hook.example.com' },
    })

    vi.useRealTimers()
  })
})
