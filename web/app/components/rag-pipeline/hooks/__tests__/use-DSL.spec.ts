import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { DSL_EXPORT_CHECK } from '@/app/components/workflow/constants'
import { createRagPipelineSliceSlice } from '../../store'
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

const renderDSL = (canEdit: boolean) =>
  renderWorkflowCanvasHook(() => useDSLByCanEdit(canEdit), {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
    initialStoreState: { knowledgeName: 'Test Knowledge Base' },
  })

describe('useDSLByCanEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
    mockExportPipelineConfig.mockResolvedValue({ data: 'yaml-content' })
    mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
  })

  it('does not export a stale draft after synchronization reports a failure', async () => {
    mockDoSyncWorkflowDraft.mockImplementation(async (_options, callback) => {
      callback.onError()
      return null
    })
    const { result } = renderDSL(true)
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
    const { result } = renderDSL(false)
    await act(async () => {
      expect(await result.current.handleExportDSL()).toBe(true)
    })
    expect(mockDownloadBlob).toHaveBeenCalledTimes(1)
  })

  describe('handleExportDSL', () => {
    it.each([false, true])(
      'exports YAML with include secrets=%s and the pipeline filename',
      async (include) => {
        const { result } = renderDSL(true)

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

      const { result } = renderDSL(true)

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

      const { result } = renderDSL(true)

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

      const { result } = renderDSL(true)

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

      const { result } = renderDSL(true)

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
