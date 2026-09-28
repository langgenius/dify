import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
const mockEventEmitter = { emit: vi.fn() }
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({ eventEmitter: mockEventEmitter }),
}))

const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({ doSyncWorkflowDraft: mockDoSyncWorkflowDraft }),
}))

const mockGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({ getState: mockGetState }),
}))

const mockExportPipelineConfig = vi.fn()
vi.mock('@/service/console', () => ({
  consoleClient: {
    rag: {
      pipelines: {
        byPipelineId: {
          exports: { get: (...args: unknown[]) => mockExportPipelineConfig(...args) },
        },
      },
    },
  },
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

const mockDownloadBlob = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))
vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
}))

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children)

describe('useDSLByCanEdit', () => {
  let mockLink: {
    href: string
    download: string
    click: ReturnType<typeof vi.fn>
    style: { display: string }
    remove: ReturnType<typeof vi.fn>
  }
  let originalCreateElement: typeof document.createElement
  let originalAppendChild: typeof document.body.appendChild
  let mockCreateObjectURL: ReturnType<typeof vi.spyOn>
  let mockRevokeObjectURL: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })

    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
      style: { display: '' },
      remove: vi.fn(),
    }

    originalCreateElement = document.createElement.bind(document)
    document.createElement = vi.fn((tagName: string) => {
      if (tagName === 'a') {
        return mockLink as unknown as HTMLElement
      }
      return originalCreateElement(tagName)
    }) as typeof document.createElement

    originalAppendChild = document.body.appendChild.bind(document.body)
    document.body.appendChild = vi.fn(
      <T extends Node>(node: T): T => node,
    ) as typeof document.body.appendChild

    mockCreateObjectURL = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test-url')
    mockRevokeObjectURL = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})

    mockGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      knowledgeName: 'Test Knowledge Base',
    })

    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportPipelineConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
  })

  afterEach(() => {
    document.createElement = originalCreateElement
    document.body.appendChild = originalAppendChild
    mockCreateObjectURL.mockRestore()
    mockRevokeObjectURL.mockRestore()
    vi.clearAllMocks()
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
    expect(mockExportPipelineConfig).not.toHaveBeenCalled()
    expect(mockDownloadBlob).not.toHaveBeenCalled()
    expect(toastMocks.call).toHaveBeenCalledTimes(1)
    expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
  })

  it('allows export when draft synchronization is skipped for read-only access', async () => {
    mockDoSyncWorkflowDraft.mockResolvedValue(null)
    const { result } = renderHook(() => useDSLByCanEdit(false), { wrapper })
    await act(async () => {
      expect(await result.current.handleExportDSL()).toBe(true)
    })
    expect(mockDownloadBlob).toHaveBeenCalledTimes(1)
  })

  describe('handleExportDSL', () => {
    it('should return early when pipelineId is not set', async () => {
      mockGetState.mockReturnValue({ pipelineId: null, knowledgeName: 'test' })

      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should create and download file', async () => {
      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalled()
    })

    it('should set correct download filename', async () => {
      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'Test Knowledge Base.pipeline',
        }),
      )
    })

    it('should pass blob data to downloadBlob', async () => {
      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.handleExportDSL()
      })

      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Blob),
        }),
      )
    })

    it('should handle export error', async () => {
      mockExportPipelineConfig.mockRejectedValue(new Error('Export failed'))

      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        expect(await result.current.handleExportDSL()).toBe(false)
      })

      await waitFor(() => {
        expect(toastMocks.call).toHaveBeenCalledWith({
          type: 'error',
          message: 'app.exportFailed',
        })
      })
    })

    it('should pass include parameter', async () => {
      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.handleExportDSL(true)
      })

      await waitFor(() => {
        expect(mockExportPipelineConfig).toHaveBeenCalledWith(
          { params: { pipeline_id: 'test-pipeline-id' }, query: { include_secret: 'true' } },
          { context: { silent: true } },
        )
      })
    })
  })

  describe('exportCheck', () => {
    it('should return early when pipelineId is not set', async () => {
      mockGetState.mockReturnValue({ pipelineId: null })

      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should call handleExportDSL directly when no secret variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })

      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith(
          '/rag/pipelines/test-pipeline-id/workflows/draft',
        )
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
      })
    })

    it('should emit event when secret variables exist', async () => {
      const secretVars = [{ value_type: 'secret', name: 'API_KEY' }]
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: secretVars })

      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockEventEmitter.emit).toHaveBeenCalledWith({
          type: expect.any(String),
          payload: {
            data: secretVars,
          },
        })
      })
    })

    it('should handle export check error', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Fetch failed'))

      const { result } = renderHook(() => useDSLByCanEdit(true), { wrapper })

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(toastMocks.call).toHaveBeenCalledWith({
          type: 'error',
          message: 'app.exportFailed',
        })
      })
    })
  })
})
