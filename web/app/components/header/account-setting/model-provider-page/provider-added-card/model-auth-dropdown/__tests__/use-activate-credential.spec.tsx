import type { Credential, ModelProvider } from '../../../declarations'
import { act, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useActivateCredential } from '../use-activate-credential'

const switchCredential = vi.fn()
const mockUpdateModelProviders = vi.fn()
const mockUpdateModelList = vi.fn()

vi.mock('../../../hooks', () => ({
  useUpdateModelProviders: () => mockUpdateModelProviders,
  useUpdateModelList: () => mockUpdateModelList,
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider =>
  ({
    provider: 'langgenius/openai/openai',
    supported_model_types: ['llm', 'text-embedding'],
    custom_configuration: {
      current_credential_id: 'cred-1',
      available_credentials: [
        { credential_id: 'cred-1', credential_name: 'Primary' },
        { credential_id: 'cred-2', credential_name: 'Backup' },
      ],
    },
    ...overrides,
  }) as unknown as ModelProvider

const createCredential = (overrides: Partial<Credential> = {}): Credential =>
  ({
    credential_id: 'cred-2',
    credential_name: 'Backup',
    ...overrides,
  }) as Credential

describe('useActivateCredential', () => {
  const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

  beforeEach(() => {
    vi.clearAllMocks()
    switchCredential.mockReset().mockResolvedValue({ result: 'success' })
    toastErrorSpy.mockClear()
  })

  it('should expose the current credential id by default', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    expect(result.current.selectedCredentialId).toBe('cred-1')
    expect(result.current.isActivating).toBe(false)
  })

  it('exposes pending state until the activation request settles', async () => {
    const request = createDeferred<unknown>()
    switchCredential.mockReturnValue(request.promise)
    const { result } = renderHook(() => useActivateCredential(createProvider()))
    act(() => result.current.activate(createCredential()))
    await waitFor(() => expect(result.current.isActivating).toBe(true))
    await act(async () => request.resolve({ result: 'success' }))
    await waitFor(() => expect(result.current.isActivating).toBe(false))
  })

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
    const { result } = renderHook(() => useActivateCredential(createProvider()))
    act(() => result.current.activate(createCredential()))
    expect(result.current.selectedCredentialId).toBe('cred-2')
    await waitFor(() =>
      expect(switchCredential).toHaveBeenCalledWith({
        params: { provider: 'langgenius/openai/openai' },
        body: { credential_id: 'cred-2' },
      }),
    )
    expect(mockUpdateModelProviders).not.toHaveBeenCalled()
    await act(async () => request.resolve({ result: 'success' }))
    await waitFor(() => expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1))
    expect(mockUpdateModelList).toHaveBeenNthCalledWith(1, 'llm')
    expect(mockUpdateModelList).toHaveBeenNthCalledWith(2, 'text-embedding')
  })

  it('rolls back optimistic selection and reports a failed activation', async () => {
    const request = createDeferred<unknown>()
    switchCredential.mockReturnValue(request.promise)
    const { result } = renderHook(() => useActivateCredential(createProvider()))
    act(() => result.current.activate(createCredential()))
    expect(result.current.selectedCredentialId).toBe('cred-2')
    await act(async () => request.reject(new Error('Activation failed')))
    await waitFor(() => expect(result.current.selectedCredentialId).toBe('cred-1'))
    expect(toastErrorSpy).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    expect(mockUpdateModelProviders).not.toHaveBeenCalled()
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
