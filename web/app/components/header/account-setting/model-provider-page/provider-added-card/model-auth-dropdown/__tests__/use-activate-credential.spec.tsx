import type { Credential, ModelProvider } from '../../../declarations'
import { act, renderHook } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import { useActivateCredential } from '../use-activate-credential'

const mockMutate = vi.fn()
const mockUpdateModelProviders = vi.fn()
const mockUpdateModelList = vi.fn()
let mockIsPending = false

vi.mock('@/service/use-models', () => ({
  useActiveProviderCredential: () => ({
    mutate: mockMutate,
    isPending: mockIsPending,
  }),
}))

vi.mock('../../../hooks', () => ({
  useUpdateModelProviders: () => mockUpdateModelProviders,
  useUpdateModelList: () => mockUpdateModelList,
}))

const createProvider = (overrides: Partial<ModelProvider> = {}): ModelProvider => ({
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
} as unknown as ModelProvider)

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  credential_id: 'cred-2',
  credential_name: 'Backup',
  ...overrides,
} as Credential)

describe('useActivateCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPending = false
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
  })

  it('should expose the current credential id by default', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    expect(result.current.selectedCredentialId).toBe('cred-1')
    expect(result.current.isActivating).toBe(false)
  })

  it('should expose the pending mutation state', () => {
    mockIsPending = true

    const { result } = renderHook(() => useActivateCredential(createProvider()))

    expect(result.current.isActivating).toBe(true)
  })

  it('should skip mutation when the selected credential is already active', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    act(() => {
      result.current.activate(createCredential({ credential_id: 'cred-1' }))
    })

    expect(mockMutate).not.toHaveBeenCalled()
    expect(result.current.selectedCredentialId).toBe('cred-1')
  })

  it('should optimistically select the credential and refresh provider data on success', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    act(() => {
      result.current.activate(createCredential())
    })

    expect(result.current.selectedCredentialId).toBe('cred-2')
    expect(mockMutate).toHaveBeenCalledWith(
      { credential_id: 'cred-2' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )

    const [, callbacks] = mockMutate.mock.calls[0]

    act(() => {
      callbacks.onSuccess()
    })

    expect(Toast.notify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.actionSuccess',
    })
    expect(mockUpdateModelProviders).toHaveBeenCalledTimes(1)
    expect(mockUpdateModelList).toHaveBeenNthCalledWith(1, 'llm')
    expect(mockUpdateModelList).toHaveBeenNthCalledWith(2, 'text-embedding')
  })

  it('should reset the optimistic selection and show an error toast when activation fails', () => {
    const { result } = renderHook(() => useActivateCredential(createProvider()))

    act(() => {
      result.current.activate(createCredential())
    })

    expect(result.current.selectedCredentialId).toBe('cred-2')

    const [, callbacks] = mockMutate.mock.calls[0]

    act(() => {
      callbacks.onError()
    })

    expect(result.current.selectedCredentialId).toBe('cred-1')
    expect(Toast.notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'common.actionMsg.modifiedUnsuccessfully',
    })
  })
})
