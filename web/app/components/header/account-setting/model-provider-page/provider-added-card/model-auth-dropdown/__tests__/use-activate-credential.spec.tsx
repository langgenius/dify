import type { Credential, ModelProvider } from '../../../declarations'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { useActivateCredential } from '../use-activate-credential'

const mockMutate = vi.fn()
const mockUpdateModelProviders = vi.fn()
const mockUpdateModelList = vi.fn()

vi.mock('@/service/use-models', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const { createTestQueryClient } = await import('@/test/query-client')
  const mutationClient = createTestQueryClient()
  return {
    useActiveProviderCredential: (_provider: string, options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockMutate(variables), ...options },
        mutationClient,
      ),
  }
})

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
    mockMutate.mockResolvedValue(undefined)
    toastErrorSpy.mockClear()
  })

  it('should expose the current credential id by default', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    expect(result.current.selectedCredentialId).toBe('cred-1')
    expect(result.current.isActivating).toBe(false)
  })

  it('should expose the pending mutation state', async () => {
    mockMutate.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useActivateCredential(createProvider()))
    act(() => {
      void result.current.activate(createCredential())
    })
    await waitFor(() => expect(result.current.isActivating).toBe(true))
  })

  it('should skip mutation when the selected credential is already active', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    act(() => {
      result.current.activate(createCredential({ credential_id: 'cred-1' }))
    })

    expect(mockMutate).not.toHaveBeenCalled()
    expect(result.current.selectedCredentialId).toBe('cred-1')
  })

  it('should optimistically select the credential and refresh provider data on success', async () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))
    await act(() => result.current.activate(createCredential()))
    expect(result.current.selectedCredentialId).toBe('cred-2')
    expect(mockMutate).toHaveBeenCalledWith({ credential_id: 'cred-2' })
    expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1)
    expect(mockUpdateModelList).toHaveBeenNthCalledWith(1, 'llm')
    expect(mockUpdateModelList).toHaveBeenNthCalledWith(2, 'text-embedding')
  })

  it('should reset the optimistic selection and show one error when activation fails', async () => {
    mockMutate.mockRejectedValue(new Error('Activation failed'))
    const { result } = renderHook(() => useActivateCredential(createProvider()))
    await act(() => result.current.activate(createCredential()))
    expect(result.current.selectedCredentialId).toBe('cred-1')
    expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith('Activation failed')
    expect(mockUpdateModelProviders).not.toHaveBeenCalled()
  })
})
