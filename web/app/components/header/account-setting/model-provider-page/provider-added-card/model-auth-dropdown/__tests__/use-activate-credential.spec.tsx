import type { Credential, ModelProvider } from '../../../declarations'
import { act, waitFor } from '@testing-library/react'
import { createProviderMeta } from '@/app/components/workflow/__tests__/model-provider-fixtures'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery as renderHook,
} from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { CustomConfigurationStatusEnum, ModelTypeEnum } from '../../../declarations'
import { useActivateCredential } from '../use-activate-credential'

const switchCredential = vi.fn()
const summaryKey = consoleQuery.workspaces.current.modelProviders.summary.get.queryKey()
const modelListKey = consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
  input: { params: { model_type: ModelTypeEnum.textGeneration } },
})

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  createProviderMeta({
    provider: 'langgenius/openai/openai',
    supported_model_types: [ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding],
    custom_configuration: {
      status: CustomConfigurationStatusEnum.active,
      current_credential_id: 'cred-1',
      available_credentials: [
        { credential_id: 'cred-1', credential_name: 'Primary' },
        { credential_id: 'cred-2', credential_name: 'Backup' },
      ],
    },
    ...overrides,
  })

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  credential_id: 'cred-2',
  credential_name: 'Backup',
  ...overrides,
})

describe('useActivateCredential', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'error').mockReturnValue('toast-error')
    switchCredential.mockReset().mockResolvedValue({ result: 'success' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('should skip mutation when the selected credential is already active', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    act(() => {
      result.current.activate(createCredential({ credential_id: 'cred-1' }))
    })

    expect(switchCredential).not.toHaveBeenCalled()
    expect(result.current.selectedCredentialId).toBe('cred-1')
  })

  it('optimistically selects the credential and refreshes provider data after success', async () => {
    const request = createDeferred<unknown>()
    switchCredential.mockReturnValue(request.promise)
    // Summaries and model lists refresh through the invalidation fallback, as in the app.
    const { result, queryClient } = renderHook(() => useActivateCredential(createProvider()), {
      queryClient: createConsoleQueryClient({ invalidation: createMutationInvalidation() }),
    })
    queryClient.setQueryData(summaryKey, { data: [] } as never)
    queryClient.setQueryData(modelListKey, { data: [] } as never)
    act(() => result.current.activate(createCredential()))
    expect(result.current.selectedCredentialId).toBe('cred-2')
    await waitFor(() => expect(result.current.isActivating).toBe(true))
    await waitFor(() =>
      expect(switchCredential).toHaveBeenCalledWith({
        params: { provider: 'langgenius/openai/openai' },
        body: { credential_id: 'cred-2' },
      }),
    )
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(false)
    await act(async () => request.resolve({ result: 'success' }))
    await waitFor(() => expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true))
    expect(queryClient.getQueryState(modelListKey)?.isInvalidated).toBe(true)
    expect(result.current.isActivating).toBe(false)
    expect(result.current.selectedCredentialId).toBe('cred-2')
  })

  it('rolls back optimistic selection and reports a failed activation', async () => {
    const request = createDeferred<unknown>()
    switchCredential.mockReturnValue(request.promise)
    const { result, queryClient } = renderHook(() => useActivateCredential(createProvider()))
    queryClient.setQueryData(summaryKey, { data: [] } as never)
    act(() => result.current.activate(createCredential()))
    expect(result.current.selectedCredentialId).toBe('cred-2')
    await act(async () => request.reject(new Error('Activation failed')))
    await waitFor(() => expect(result.current.selectedCredentialId).toBe('cred-1'))
    expect(toast.error).toHaveBeenCalledWith('Activation failed')
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(false)
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.credentials.switch.post': (input) =>
        switchCredential(input),
    }),
  }
})
