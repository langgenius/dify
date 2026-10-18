import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
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
vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
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

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children)

describe('useDSLByCanEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })

    mockGetState.mockReturnValue({
      pipelineId: 'test-pipeline-id',
      knowledgeName: 'Test Knowledge Base',
    })

    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportPipelineConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('does not export a stale draft after synchronization reports a failure', async () => {
    mockDoSyncWorkflowDraft.mockImplementation(async (_options, callback) => {
      callback.onError()
      return null
    })
    const { result } = renderHook(() => useDSLByCanEdit(true), {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      wrapper,
    })
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
    const { result } = renderHook(() => useDSLByCanEdit(false), {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
      wrapper,
    })
    await act(async () => {
      expect(await result.current.handleExportDSL()).toBe(true)
    })
    expect(mockDownloadBlob).toHaveBeenCalledTimes(1)
  })

  describe('handleExportDSL', () => {
    it.each([false, true])(
      'exports YAML with include secrets=%s and the pipeline filename',
      async (include) => {
        const { result } = renderHook(() => useDSLByCanEdit(true), {
          resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
          wrapper,
        })

        await act(async () => {
          expect(await result.current.handleExportDSL(include)).toBe(true)
        })

        expect(mockExportPipelineConfig).toHaveBeenCalledExactlyOnceWith(
          {
            params: { pipeline_id: 'test-pipeline-id' },
            query: { include_secret: String(include) },
          },
          { context: { silent: true } },
        )
        expect(mockDownloadBlob).toHaveBeenCalledExactlyOnceWith({
          fileName: 'Test Knowledge Base.pipeline',
          data: expect.any(Blob),
        })
        const blob = mockDownloadBlob.mock.calls[0]![0].data as Blob
        expect(blob.type).toBe('application/yaml')
        expect(await blob.text()).toBe('yaml-content')
      },
    )

    it('should handle export error', async () => {
      mockExportPipelineConfig.mockRejectedValue(new Error('Export failed'))

      const { result } = renderHook(() => useDSLByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
        wrapper,
      })

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
  })

  describe('exportCheck', () => {
    it('should call handleExportDSL directly when no secret variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })

      const { result } = renderHook(() => useDSLByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
        wrapper,
      })

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockFetchWorkflowDraft).toHaveBeenCalledWith(
          '/rag/pipelines/test-pipeline-id/workflows/draft',
        )
        expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
      })
      expect(mockDownloadBlob).toHaveBeenCalledOnce()
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
    })

    it('should emit event when secret variables exist', async () => {
      const secretVars = [{ value_type: 'secret', name: 'API_KEY', value: 'masked' }]
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [
          ...secretVars,
          { value_type: 'string', name: 'URL', value: 'https://example.com' },
        ],
      })

      const { result } = renderHook(() => useDSLByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
        wrapper,
      })

      await act(async () => {
        await result.current.exportCheck()
      })

      await waitFor(() => {
        expect(mockEventEmitter.emit).toHaveBeenCalledWith({
          type: DSL_EXPORT_CHECK,
          payload: {
            data: secretVars,
          },
        })
      })
      expect(mockDownloadBlob).not.toHaveBeenCalled()
      expect(mockExportPipelineConfig).not.toHaveBeenCalled()
    })

    it('should handle export check error', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('Fetch failed'))

      const { result } = renderHook(() => useDSLByCanEdit(true), {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
        wrapper,
      })

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
