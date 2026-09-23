import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { useDSLByCanEdit } from '../use-DSL'

const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
const mockEmit = vi.fn()
const mockDoSyncWorkflowDraft = vi.fn()
const mockExportAppConfig = vi.fn()
const mockFetchEnvironmentVariables = vi.fn()
const mockDownloadBlob = vi.fn()

let appStoreState: {
  appDetail?: {
    id: string
    name: string
  }
}

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
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        export: { get: (...args: unknown[]) => mockExportAppConfig(...args) },
        workflows: {
          draft: {
            environmentVariables: {
              get: (...args: unknown[]) => mockFetchEnvironmentVariables(...args),
            },
          },
        },
      },
    },
  },
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

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children)

describe('useDSLByCanEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    appStoreState = {
      appDetail: {
        id: 'app-1',
        name: 'Workflow App',
      },
    }
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportAppConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchEnvironmentVariables.mockResolvedValue({ items: [] })
  })

  it('does not export a stale draft after synchronization reports a failure', async () => {
    mockDoSyncWorkflowDraft.mockImplementation(async (_options, callback) => {
      callback.onError()
      return null
    })
    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })
    await act(async () => {
      expect(await result.current.handleExportDSL()).toBe(false)
    })
    expect(mockExportAppConfig).not.toHaveBeenCalled()
    expect(mockDownloadBlob).not.toHaveBeenCalled()
    expect(toastMocks.call).toHaveBeenCalledTimes(1)
    expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'app.exportAppFailed' })
  })

  it('allows export when draft synchronization is skipped for read-only access', async () => {
    mockDoSyncWorkflowDraft.mockResolvedValue(null)
    const { result } = renderHook(() => useDSLByCanEdit(false), { wrapper })
    await act(async () => {
      expect(await result.current.handleExportDSL()).toBe(true)
    })
    expect(mockDownloadBlob).toHaveBeenCalledTimes(1)
  })

  it('downloads the default package bytes and forwards the selected workflow version', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0xff])], 'workflow.ifpkg')
    mockExportAppConfig.mockResolvedValue(file)
    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })
    await act(async () => {
      expect(await result.current.handleExportDSL(true, 'revision-1')).toBe(true)
    })
    expect(mockExportAppConfig).toHaveBeenCalledWith(
      {
        params: { app_id: 'app-1' },
        query: { include_secret: true, workflow_id: 'revision-1' },
      },
      { context: { silent: true } },
    )
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockDownloadBlob).toHaveBeenCalledWith({ data: file, fileName: 'workflow.ifpkg' })
  })

  it('should export workflow dsl and download the yaml blob when no secret env is present', async () => {
    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

    await act(async () => {
      await result.current.exportCheck()
    })

    expect(mockFetchEnvironmentVariables).toHaveBeenCalledWith(
      { params: { app_id: 'app-1' } },
      { context: { silent: true } },
    )
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
    expect(mockExportAppConfig).toHaveBeenCalledWith(
      {
        params: { app_id: 'app-1' },
        query: { include_secret: false, workflow_id: undefined },
      },
      { context: { silent: true } },
    )
    expect(mockDownloadBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Blob),
        fileName: 'Workflow App.yml',
      }),
    )
  })

  it('should download workflow DSL containing portable Agent packages unchanged', async () => {
    const agentDSL = `version: 0.7.0
agent_packages:
  agent_1:
    schema_version: 1
workflow:
  graph:
    nodes:
      - data:
          type: agent
          version: '2'
          agent_binding:
            binding_type: inline_agent
            package_ref: agent_1
`
    mockExportAppConfig.mockResolvedValue({ data: agentDSL })
    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

    await act(async () => {
      await result.current.handleExportDSL()
    })

    const [{ data, fileName }] = mockDownloadBlob.mock.calls[0] as [
      { data: Blob; fileName: string },
    ]
    expect(await data.text()).toBe(agentDSL)
    expect(fileName).toBe('Workflow App.yml')
  })

  it('should forward include and workflow id arguments when exporting dsl directly', async () => {
    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

    await act(async () => {
      await result.current.handleExportDSL(true, 'workflow-1')
    })

    expect(mockExportAppConfig).toHaveBeenCalledWith(
      {
        params: { app_id: 'app-1' },
        query: { include_secret: true, workflow_id: 'workflow-1' },
      },
      { context: { silent: true } },
    )
  })

  it('should emit DSL_EXPORT_CHECK when secret environment variables exist', async () => {
    const secretVars = [{ id: 'env-1', value_type: 'secret', value: 'secret-token' }]
    mockFetchEnvironmentVariables.mockResolvedValue({ items: secretVars })

    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

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

    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

    await act(async () => {
      await result.current.exportCheck()
      await result.current.handleExportDSL()
    })

    expect(mockFetchEnvironmentVariables).not.toHaveBeenCalled()
    expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockExportAppConfig).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('should notify when export fails', async () => {
    mockExportAppConfig.mockRejectedValue(
      new Response(JSON.stringify({ message: 'Package contains unusable Skill' }), { status: 500 }),
    )

    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

    await act(async () => {
      expect(await result.current.handleExportDSL()).toBe(false)
    })

    await waitFor(() => {
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.exportAppFailed',
        description: 'Package contains unusable Skill',
      })
    })
  })

  it('should notify when exportCheck cannot load the workflow draft', async () => {
    mockFetchEnvironmentVariables.mockRejectedValue(new Error('draft fetch failed'))

    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

    await act(async () => {
      await result.current.exportCheck()
    })

    await waitFor(() => {
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.exportAppFailed',
        description: 'draft fetch failed',
      })
    })
    expect(mockExportAppConfig).not.toHaveBeenCalled()
  })

  it('keeps export pending through draft synchronization and download and ignores repeated attempts', async () => {
    const sync = createDeferred<void>()
    const deferred = createDeferred<{ data: string }>()
    mockDoSyncWorkflowDraft.mockReturnValue(sync.promise)
    mockExportAppConfig.mockReturnValue(deferred.promise)

    const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })
    let firstExportPromise!: Promise<boolean>

    act(() => {
      firstExportPromise = result.current.handleExportDSL()
    })

    await waitFor(() => expect(result.current.isExporting).toBe(true))
    expect(mockDoSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    expect(mockExportAppConfig).not.toHaveBeenCalled()

    await act(async () => {
      sync.resolve()
    })
    expect(mockExportAppConfig).toHaveBeenCalledTimes(1)
    expect(result.current.isExporting).toBe(true)

    act(() => {
      void result.current.handleExportDSL()
    })

    expect(mockExportAppConfig).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve({ data: 'yaml-content' })
      expect(await firstExportPromise).toBe(true)
    })
    await waitFor(() => expect(result.current.isExporting).toBe(false))
  })
})
