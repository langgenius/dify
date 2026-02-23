import type {
  Credential,
  CustomModel,
  ModelProvider,
} from '../../declarations'
import { act, renderHook } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelModalModeEnum, ModelTypeEnum } from '../../declarations'
import { useAuth } from './use-auth'

const mockNotify = vi.fn()
const mockHandleRefreshModel = vi.fn()
const mockOpenModelModal = vi.fn()
const mockDeleteModelService = vi.fn()
const mockDeleteProviderCredential = vi.fn()
const mockDeleteModelCredential = vi.fn()
const mockActiveProviderCredential = vi.fn()
const mockActiveModelCredential = vi.fn()
const mockAddProviderCredential = vi.fn()
const mockAddModelCredential = vi.fn()
const mockEditProviderCredential = vi.fn()
const mockEditModelCredential = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelModalHandler: () => mockOpenModelModal,
  useRefreshModel: () => ({ handleRefreshModel: mockHandleRefreshModel }),
}))

vi.mock('@/service/use-models', () => ({
  useDeleteModel: () => ({ mutateAsync: mockDeleteModelService }),
}))

vi.mock('./use-auth-service', () => ({
  useAuthService: () => ({
    getDeleteCredentialService: (isModel: boolean) => (isModel ? mockDeleteModelCredential : mockDeleteProviderCredential),
    getActiveCredentialService: (isModel: boolean) => (isModel ? mockActiveModelCredential : mockActiveProviderCredential),
    getEditCredentialService: (isModel: boolean) => (isModel ? mockEditModelCredential : mockEditProviderCredential),
    getAddCredentialService: (isModel: boolean) => (isModel ? mockAddModelCredential : mockAddProviderCredential),
  }),
}))

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useAuth', () => {
  const provider = {
    provider: 'openai',
    allow_custom_token: true,
  } as ModelProvider

  const credential: Credential = {
    credential_id: 'cred-1',
    credential_name: 'Primary key',
  }

  const model: CustomModel = {
    model: 'gpt-4',
    model_type: ModelTypeEnum.textGeneration,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteModelService.mockResolvedValue({ result: 'success' })
    mockDeleteProviderCredential.mockResolvedValue({ result: 'success' })
    mockDeleteModelCredential.mockResolvedValue({ result: 'success' })
    mockActiveProviderCredential.mockResolvedValue({ result: 'success' })
    mockActiveModelCredential.mockResolvedValue({ result: 'success' })
    mockAddProviderCredential.mockResolvedValue({ result: 'success' })
    mockAddModelCredential.mockResolvedValue({ result: 'success' })
    mockEditProviderCredential.mockResolvedValue({ result: 'success' })
    mockEditModelCredential.mockResolvedValue({ result: 'success' })
  })

  it('should open and close delete confirmation state', () => {
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel))

    act(() => {
      result.current.openConfirmDelete(credential, model)
    })

    expect(result.current.deleteCredentialId).toBe('cred-1')
    expect(result.current.deleteModel).toEqual(model)
    expect(result.current.pendingOperationCredentialId.current).toBe('cred-1')
    expect(result.current.pendingOperationModel.current).toEqual(model)

    act(() => {
      result.current.closeConfirmDelete()
    })

    expect(result.current.deleteCredentialId).toBeNull()
    expect(result.current.deleteModel).toBeNull()
  })

  it('should activate credential, notify success, and refresh models', async () => {
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.customizableModel))

    await act(async () => {
      await result.current.handleActiveCredential(credential, model)
    })

    expect(mockActiveModelCredential).toHaveBeenCalledWith({
      credential_id: 'cred-1',
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
    })
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: 'common.api.actionSuccess',
    }))
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, true)
    expect(result.current.doingAction).toBe(false)
  })

  it('should close delete dialog without calling services when nothing is pending', async () => {
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel))

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(mockDeleteProviderCredential).not.toHaveBeenCalled()
    expect(mockDeleteModelService).not.toHaveBeenCalled()
    expect(result.current.deleteCredentialId).toBeNull()
    expect(result.current.deleteModel).toBeNull()
  })

  it('should delete credential and call onRemove callback', async () => {
    const onRemove = vi.fn()
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel, undefined, {
      isModelCredential: false,
      onRemove,
    }))

    act(() => {
      result.current.openConfirmDelete(credential, model)
    })

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(mockDeleteProviderCredential).toHaveBeenCalledWith({
      credential_id: 'cred-1',
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
    })
    expect(mockDeleteModelService).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith('cred-1')
    expect(result.current.deleteCredentialId).toBeNull()
  })

  it('should delete model when pending operation has no credential id', async () => {
    const onRemove = vi.fn()
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.customizableModel, undefined, {
      onRemove,
    }))

    act(() => {
      result.current.openConfirmDelete(undefined, model)
    })

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(mockDeleteModelService).toHaveBeenCalledWith({
      model: 'gpt-4',
      model_type: ModelTypeEnum.textGeneration,
    })
    expect(onRemove).toHaveBeenCalledWith('')
  })

  it('should add or edit credentials and refresh on successful save', async () => {
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel))

    await act(async () => {
      await result.current.handleSaveCredential({ api_key: 'new-key' })
    })

    expect(mockAddProviderCredential).toHaveBeenCalledWith({ api_key: 'new-key' })
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, true)

    await act(async () => {
      await result.current.handleSaveCredential({ credential_id: 'cred-1', api_key: 'updated-key' })
    })

    expect(mockEditProviderCredential).toHaveBeenCalledWith({ credential_id: 'cred-1', api_key: 'updated-key' })
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, false)
  })

  it('should ignore duplicate save requests while an action is in progress', async () => {
    const deferred = createDeferred<{ result: string }>()
    mockAddProviderCredential.mockReturnValueOnce(deferred.promise)

    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel))

    let first!: Promise<void>
    let second!: Promise<void>

    await act(async () => {
      first = result.current.handleSaveCredential({ api_key: 'first' })
      second = result.current.handleSaveCredential({ api_key: 'second' })
      deferred.resolve({ result: 'success' })
      await Promise.all([first, second])
    })

    expect(mockAddProviderCredential).toHaveBeenCalledTimes(1)
    expect(mockAddProviderCredential).toHaveBeenCalledWith({ api_key: 'first' })
  })

  it('should forward modal open arguments', () => {
    const onUpdate = vi.fn()
    const fixedFields = {
      __model_name: 'gpt-4',
      __model_type: ModelTypeEnum.textGeneration,
    }
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.customizableModel, fixedFields, {
      isModelCredential: true,
      onUpdate,
      mode: ModelModalModeEnum.configModelCredential,
    }))

    act(() => {
      result.current.handleOpenModal(credential, model)
    })

    expect(mockOpenModelModal).toHaveBeenCalledWith(
      provider,
      ConfigurationMethodEnum.customizableModel,
      fixedFields,
      expect.objectContaining({
        isModelCredential: true,
        credential,
        model,
        onUpdate,
      }),
    )
  })
})
