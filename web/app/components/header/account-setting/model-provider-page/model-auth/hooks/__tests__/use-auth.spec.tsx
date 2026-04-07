import type { ReactNode } from 'react'
import type {
  Credential,
  CustomModel,
  ModelProvider,
} from '../../../declarations'
import { act, renderHook } from '@testing-library/react'
import { ConfigurationMethodEnum, ModelModalModeEnum, ModelTypeEnum } from '../../../declarations'
import { useAuth } from '../use-auth'

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

vi.mock('@/app/components/base/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/ui/toast')>()
  return {
    ...actual,
    default: {
      notify: (args: unknown) => mockNotify(args),
    },
    toast: {
      success: (message: string) => mockNotify({ type: 'success', message }),
      error: (message: string) => mockNotify({ type: 'error', message }),
      warning: (message: string) => mockNotify({ type: 'warning', message }),
      info: (message: string) => mockNotify({ type: 'info', message }),
    },
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelModalHandler: () => mockOpenModelModal,
  useRefreshModel: () => ({ handleRefreshModel: mockHandleRefreshModel }),
}))

vi.mock('@/service/use-models', () => ({
  useDeleteModel: () => ({ mutateAsync: mockDeleteModelService }),
}))

vi.mock('../use-auth-service', () => ({
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

  const createWrapper = ({ children }: { children: ReactNode }) => (
    <>
      {children}
    </>
  )

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
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

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
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.customizableModel), { wrapper: createWrapper })

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
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

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
    }), { wrapper: createWrapper })

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
    }), { wrapper: createWrapper })

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
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

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

    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

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
    }), { wrapper: createWrapper })

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

  it('should not notify or refresh when handleSaveCredential returns non-success result', async () => {
    mockAddProviderCredential.mockResolvedValue({ result: 'error' })

    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

    await act(async () => {
      await result.current.handleSaveCredential({ api_key: 'some-key' })
    })

    expect(mockAddProviderCredential).toHaveBeenCalledWith({ api_key: 'some-key' })
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockHandleRefreshModel).not.toHaveBeenCalled()
  })

  it('should pass undefined model and model_type when handleActiveCredential is called without a model parameter', async () => {
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

    await act(async () => {
      await result.current.handleActiveCredential(credential)
    })

    expect(mockActiveProviderCredential).toHaveBeenCalledWith({
      credential_id: 'cred-1',
      model: undefined,
      model_type: undefined,
    })
  })

  // openConfirmDelete with credential only (no model): deleteCredentialId set, deleteModel stays null
  it('should only set deleteCredentialId when openConfirmDelete is called without a model', () => {
    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

    act(() => {
      result.current.openConfirmDelete(credential, undefined)
    })

    expect(result.current.deleteCredentialId).toBe('cred-1')
    expect(result.current.deleteModel).toBeNull()
    expect(result.current.pendingOperationCredentialId.current).toBe('cred-1')
    expect(result.current.pendingOperationModel.current).toBeNull()
  })

  // doingActionRef guard: second handleConfirmDelete call while first is in progress is a no-op
  it('should ignore a second handleConfirmDelete call while the first is still in progress', async () => {
    const deferred = createDeferred<{ result: string }>()
    mockDeleteProviderCredential.mockReturnValueOnce(deferred.promise)

    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

    act(() => {
      result.current.openConfirmDelete(credential, model)
    })

    let first!: Promise<void>
    let second!: Promise<void>

    await act(async () => {
      first = result.current.handleConfirmDelete()
      second = result.current.handleConfirmDelete()
      deferred.resolve({ result: 'success' })
      await Promise.all([first, second])
    })

    expect(mockDeleteProviderCredential).toHaveBeenCalledTimes(1)
  })

  // doingActionRef guard: second handleActiveCredential call while first is in progress is a no-op
  it('should ignore a second handleActiveCredential call while the first is still in progress', async () => {
    const deferred = createDeferred<{ result: string }>()
    mockActiveProviderCredential.mockReturnValueOnce(deferred.promise)

    const { result } = renderHook(() => useAuth(provider, ConfigurationMethodEnum.predefinedModel), { wrapper: createWrapper })

    let first!: Promise<void>
    let second!: Promise<void>

    await act(async () => {
      first = result.current.handleActiveCredential(credential)
      second = result.current.handleActiveCredential(credential)
      deferred.resolve({ result: 'success' })
      await Promise.all([first, second])
    })

    expect(mockActiveProviderCredential).toHaveBeenCalledTimes(1)
  })
})
