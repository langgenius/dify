import type { Credential, CustomModel, ModelProvider } from '../../../declarations'
import { act, renderHook } from '@testing-library/react'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
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

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
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

describe('useAuth', () => {
  const provider = createProviderResponseFixture() as ModelProvider

  const credential: Credential = {
    credential_id: 'cred-1',
    credential_name: 'Primary key',
  }

  const model: CustomModel = {
    model: 'gpt-4',
    model_type: ModelTypeEnum.textGeneration,
  }

  let createWrapper = createConsoleQueryWrapper().wrapper

  beforeEach(() => {
    vi.resetAllMocks()
    createWrapper = createConsoleQueryWrapper().wrapper
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

  it('should activate credential, notify success, and refresh models', async () => {
    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.customizableModel),
      { wrapper: createWrapper },
    )

    await act(async () => {
      await result.current.handleActiveCredential(credential, model)
    })

    expect(mockActiveModelCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: {
        credential_id: 'cred-1',
        model: 'gpt-4',
        model_type: ModelTypeEnum.textGeneration,
      },
    })
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'common.api.actionSuccess',
      }),
    )
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, true)
    expect(result.current.doingAction).toBe(false)
  })

  it('should close delete dialog without calling services when nothing is pending', async () => {
    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

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
    const { result } = renderHook(
      () =>
        useAuth(provider, ConfigurationMethodEnum.predefinedModel, undefined, {
          isModelCredential: false,
          onRemove,
        }),
      { wrapper: createWrapper },
    )

    act(() => {
      result.current.openConfirmDelete(credential, model)
    })

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(mockDeleteProviderCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: {
        credential_id: 'cred-1',
      },
    })
    expect(mockDeleteModelService).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith('cred-1')
    expect(result.current.deleteCredentialId).toBeNull()
  })

  it('should delete model when pending operation has no credential id', async () => {
    const onRemove = vi.fn()
    const { result } = renderHook(
      () =>
        useAuth(provider, ConfigurationMethodEnum.customizableModel, undefined, {
          onRemove,
        }),
      { wrapper: createWrapper },
    )

    act(() => {
      result.current.openConfirmDelete(undefined, model)
    })

    await act(async () => {
      await result.current.handleConfirmDelete()
    })

    expect(mockDeleteModelService).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      query: { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration },
    })
    expect(onRemove).toHaveBeenCalledWith('')
  })

  it('should add or edit credentials and refresh on successful save', async () => {
    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

    await act(async () => {
      await result.current.handleSaveCredential({ credentials: { api_key: 'new-key' } })
    })

    expect(mockAddProviderCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: { credentials: { api_key: 'new-key' } },
    })
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, true)

    await act(async () => {
      await result.current.handleSaveCredential({
        credential_id: 'cred-1',
        credentials: { api_key: 'updated-key' },
      })
    })

    expect(mockEditProviderCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: {
        credential_id: 'cred-1',
        credentials: { api_key: 'updated-key' },
      },
    })
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, false)
  })

  it('should ignore duplicate save requests while an action is in progress', async () => {
    const deferred = createDeferred<{ result: string }>()
    mockAddProviderCredential.mockReturnValueOnce(deferred.promise)

    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

    let first!: Promise<void>
    let second!: Promise<void>

    await act(async () => {
      first = result.current.handleSaveCredential({ credentials: { api_key: 'first' } })
      second = result.current.handleSaveCredential({ credentials: { api_key: 'second' } })
      deferred.resolve({ result: 'success' })
      await Promise.all([first, second])
    })

    expect(mockAddProviderCredential).toHaveBeenCalledTimes(1)
    expect(mockAddProviderCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: { credentials: { api_key: 'first' } },
    })
  })

  it('releases the pending action after a failed save so the user can retry', async () => {
    const error = new Error('Save failed')
    mockAddProviderCredential.mockRejectedValueOnce(error)
    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )
    const payload = { credentials: { api_key: 'retry-key' } }
    await act(async () => {
      await expect(result.current.handleSaveCredential(payload)).rejects.toBe(error)
    })
    expect(result.current.doingAction).toBe(false)
    expect(mockHandleRefreshModel).not.toHaveBeenCalled()
    await act(async () => result.current.handleSaveCredential(payload))
    expect(mockAddProviderCredential).toHaveBeenCalledTimes(2)
    expect(mockHandleRefreshModel).toHaveBeenCalledWith(provider, undefined, true)
  })

  it('should forward modal open arguments', () => {
    const onUpdate = vi.fn()
    const fixedFields = {
      __model_name: 'gpt-4',
      __model_type: ModelTypeEnum.textGeneration,
    }
    const { result } = renderHook(
      () =>
        useAuth(provider, ConfigurationMethodEnum.customizableModel, fixedFields, {
          isModelCredential: true,
          onUpdate,
          mode: ModelModalModeEnum.configModelCredential,
        }),
      { wrapper: createWrapper },
    )

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

    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

    await act(async () => {
      await result.current.handleSaveCredential({ credentials: { api_key: 'some-key' } })
    })

    expect(mockAddProviderCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: { credentials: { api_key: 'some-key' } },
    })
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockHandleRefreshModel).not.toHaveBeenCalled()
  })

  it('activates provider credentials without model fields', async () => {
    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

    await act(async () => {
      await result.current.handleActiveCredential(credential)
    })

    expect(mockActiveProviderCredential).toHaveBeenCalledWith({
      params: { provider: 'openai' },
      body: {
        credential_id: 'cred-1',
      },
    })
  })

  // openConfirmDelete with credential only (no model): deleteCredentialId set, deleteModel stays null

  // doingActionRef guard: second handleConfirmDelete call while first is in progress is a no-op
  it('should ignore a second handleConfirmDelete call while the first is still in progress', async () => {
    const deferred = createDeferred<{ result: string }>()
    mockDeleteProviderCredential.mockReturnValueOnce(deferred.promise)

    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

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

    const { result } = renderHook(
      () => useAuth(provider, ConfigurationMethodEnum.predefinedModel),
      { wrapper: createWrapper },
    )

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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.delete': (input) =>
        mockDeleteModelService(input),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.credentials.post': (input) =>
        mockAddProviderCredential(input),
      'workspaces.current.modelProviders.byProvider.credentials.put': (input) =>
        mockEditProviderCredential(input),
      'workspaces.current.modelProviders.byProvider.credentials.delete': (input) =>
        mockDeleteProviderCredential(input),
      'workspaces.current.modelProviders.byProvider.credentials.switch.post': (input) =>
        mockActiveProviderCredential(input),
      'workspaces.current.modelProviders.byProvider.models.credentials.post': (input) =>
        mockAddModelCredential(input),
      'workspaces.current.modelProviders.byProvider.models.credentials.put': (input) =>
        mockEditModelCredential(input),
      'workspaces.current.modelProviders.byProvider.models.credentials.delete': (input) =>
        mockDeleteModelCredential(input),
      'workspaces.current.modelProviders.byProvider.models.credentials.switch.post': (input) =>
        mockActiveModelCredential(input),
    }),
  }
})
