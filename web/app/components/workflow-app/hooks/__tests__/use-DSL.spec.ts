import { act, renderHook, waitFor } from '@testing-library/react'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useDSL } from '../use-DSL'

const mockNotify = vi.fn()
const mockEmit = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()
const mockExportAppConfig = vi.fn()
const mockFetchWorkflowDraft = vi.fn()
const mockDownloadBlob = vi.fn()

let appStoreState: {
  appDetail?: {
    id: string
    name: string
  }
}

vi.mock('@/app/components/base/toast/context', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T>(selector: (state: typeof appStoreState) => T) => selector(appStoreState),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('@/service/apps', () => ({
  exportAppConfig: (...args: unknown[]) => mockExportAppConfig(...args),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useDSL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appStoreState = {
      appDetail: {
        id: 'app-1',
        name: 'Workflow App',
      },
    }
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportAppConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
  })

  it('should export workflow dsl and download the yaml blob when no secret env is present', async () => {
    const { result } = renderHook(() => useDSL())

    await act(async () => {
      await result.current.exportCheck()
    })

    expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('/apps/app-1/workflows/draft')
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockExportAppConfig).toHaveBeenCalledWith({
      appID: 'app-1',
      include: false,
      workflowID: undefined,
    })
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Blob),
      fileName: 'Workflow App.yml',
    }))
  })

  it('should forward include and workflow id arguments when exporting dsl directly', async () => {
    const { result } = renderHook(() => useDSL())

    await act(async () => {
      await result.current.handleExportDSL(true, 'workflow-1')
    })

    expect(mockExportAppConfig).toHaveBeenCalledWith({
      appID: 'app-1',
      include: true,
      workflowID: 'workflow-1',
    })
  })

  it('should emit DSL_EXPORT_CHECK when secret environment variables exist', async () => {
    const secretVars = [{ id: 'env-1', value_type: 'secret', value: 'secret-token' }]
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: secretVars })

    const { result } = renderHook(() => useDSL())

    await act(async () => {
      await result.current.exportCheck()
    })

    expect(mockEmit).toHaveBeenCalledWith({
      type: DSL_EXPORT_CHECK,
      payload: {
        data: secretVars,
      },
    })
    expect(mockExportAppConfig).not.toHaveBeenCalled()
  })

  it('should return early when app detail is unavailable', async () => {
    appStoreState = {}

    const { result } = renderHook(() => useDSL())

    await act(async () => {
      await result.current.exportCheck()
      await result.current.handleExportDSL()
    })

    expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockExportAppConfig).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('should notify when export fails', async () => {
    mockExportAppConfig.mockRejectedValue(new Error('export failed'))

    const { result } = renderHook(() => useDSL())

    await act(async () => {
      await result.current.handleExportDSL()
    })

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.exportFailed',
      })
    })
  })

  it('should notify when exportCheck cannot load the workflow draft', async () => {
    mockFetchWorkflowDraft.mockRejectedValue(new Error('draft fetch failed'))

    const { result } = renderHook(() => useDSL())

    await act(async () => {
      await result.current.exportCheck()
    })

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.exportFailed',
      })
    })
    expect(mockExportAppConfig).not.toHaveBeenCalled()
  })

  it('should ignore repeated export attempts while an export is already in progress', async () => {
    const deferred = createDeferred<{ data: string }>()
    mockExportAppConfig.mockReturnValue(deferred.promise)

    const { result } = renderHook(() => useDSL())
    let firstExportPromise!: Promise<void>

    act(() => {
      firstExportPromise = result.current.handleExportDSL()
    })

    await waitFor(() => {
      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
      expect(mockExportAppConfig).toHaveBeenCalledTimes(1)
    })

    act(() => {
      void result.current.handleExportDSL()
    })

    expect(mockExportAppConfig).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve({ data: 'yaml-content' })
      await firstExportPromise
    })
  })
})
