import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WORKFLOW_DATA_UPDATE } from '@/app/components/workflow/constants'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { httpErrorFromResponse } from '@/service/http-error'
import { useUpdateDSLModal } from '../use-update-dsl-modal'

class MockFileReader {
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => void) | null = null

  readAsText(_file: Blob) {
    const event = { target: { result: 'test content' } } as unknown as ProgressEvent<FileReader>
    this.onload?.call(this as unknown as FileReader, event)
  }
}

const toastMocks = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    api: vi.fn((message: unknown, options?: Record<string, unknown>) =>
      call({ message, ...options }),
    ),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(toastMocks.api, {
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
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { emit: mockEmit },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({ pipelineId: 'test-pipeline-id' }),
  }),
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.imports.post': (input) => mockImportDSL(input),
      'rag.pipelines.imports.byImportId.confirm.post': (input) => mockImportDSLConfirm(input),
    }),
  }
})

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    hash: 'test-hash',
    rag_pipeline_variables: [],
  }),
}))

const createFile = () => new File(['test content'], 'test.pipeline', { type: 'text/yaml' })

type AsyncFn = () => Promise<void>

describe('useUpdateDSLModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnImport = vi.fn()

  const renderUpdateDSLModal = (overrides?: { onImport?: () => void }) =>
    renderHook(
      () =>
        useUpdateDSLModal({
          onCancel: mockOnCancel,
          onImport: overrides?.onImport ?? mockOnImport,
        }),
      { resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' } },
    )

  beforeEach(() => {
    vi.stubGlobal('FileReader', MockFileReader as typeof FileReader)
    vi.clearAllMocks()
    mockImportDSL.mockResolvedValue({
      id: 'import-id',
      status: DSLImportStatus.COMPLETED,
      pipeline_id: 'test-pipeline-id',
    })
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('handleImport', () => {
    it('should call importDSL with correct parameters', async () => {
      const { result } = renderUpdateDSLModal()

      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(mockImportDSL).toHaveBeenCalledWith({
        body: {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: 'test content',
          pipeline_id: 'test-pipeline-id',
        },
      })
      expect(mockOnImport).toHaveBeenCalledOnce()
      expect(mockOnCancel).toHaveBeenCalledOnce()
      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledExactlyOnceWith(
        'test-pipeline-id',
        true,
      )
      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
      expect(mockEmit).toHaveBeenCalledExactlyOnceWith({
        type: WORKFLOW_DATA_UPDATE,
        payload: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          hash: 'test-hash',
          rag_pipeline_variables: [],
        },
      })
    })

    it('should not call importDSL when no file is selected', async () => {
      const { result } = renderUpdateDSLModal()

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(mockImportDSL).not.toHaveBeenCalled()
    })

    it('should notify warning on COMPLETED_WITH_WARNINGS status', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
        pipeline_id: 'test-pipeline-id',
      })

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }))
    })

    it('should switch to version mismatch modal on PENDING status', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '0.8.0',
        current_dsl_version: '1.0.0',
      })

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
        await vi.advanceTimersByTimeAsync(350)
      })

      expect(result.current.show).toBe(false)
      expect(result.current.showErrorModal).toBe(true)
      expect(result.current.versions).toEqual({
        importedVersion: '0.8.0',
        systemVersion: '1.0.0',
      })

      vi.useRealTimers()
    })

    it('should notify error on FAILED status', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.FAILED,
        pipeline_id: 'test-pipeline-id',
        error: 'Missing rag_pipeline data in YAML content',
      })

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'Missing rag_pipeline data in YAML content',
      })
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should notify error when importDSL throws', async () => {
      mockImportDSL.mockRejectedValue(new Error('Network error'))

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should notify response error when importDSL rejects with a response body', async () => {
      mockImportDSL.mockRejectedValue(
        await httpErrorFromResponse(
          new Response(
            JSON.stringify({
              error: 'Missing rag_pipeline data in YAML content',
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
      )

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'Missing rag_pipeline data in YAML content',
      })
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should notify error when pipeline_id is missing on success', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.COMPLETED,
        pipeline_id: undefined,
      })

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })
  })

  describe('onUpdateDSLConfirm', () => {
    const setupPendingState = async (result: { current: ReturnType<typeof useUpdateDSLModal> }) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: '0.8.0',
        current_dsl_version: '1.0.0',
      })

      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as AsyncFn)()
        await vi.advanceTimersByTimeAsync(350)
      })

      vi.useRealTimers()
      vi.clearAllMocks()
      mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
    }

    it('should call importDSLConfirm with the stored importId', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as AsyncFn)()
      })

      expect(mockImportDSLConfirm).toHaveBeenCalledWith({ params: { import_id: 'import-id' } })
      expect(mockOnImport).toHaveBeenCalledOnce()
      expect(mockOnCancel).toHaveBeenCalledOnce()
      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledExactlyOnceWith(
        'test-pipeline-id',
        true,
      )
      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    })

    it('should notify error on FAILED confirm status', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.FAILED,
        pipeline_id: 'test-pipeline-id',
        error: 'Import information expired or does not exist',
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'Import information expired or does not exist',
      })
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should notify error when confirm throws exception', async () => {
      mockImportDSLConfirm.mockRejectedValue(new Error('Confirm failed'))

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should notify response error when confirm rejects with a response body', async () => {
      mockImportDSLConfirm.mockRejectedValue(
        await httpErrorFromResponse(
          new Response(
            JSON.stringify({
              error: 'Import information expired or does not exist',
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
      )

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'Import information expired or does not exist',
      })
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should notify error when confirm succeeds but pipeline_id is missing', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: undefined,
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as AsyncFn)()
      })

      expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      expect(mockOnImport).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockHandleCheckPluginDependencies).not.toHaveBeenCalled()
      expect(result.current.loading).toBe(false)
    })

    it('should not call importDSLConfirm when importId is not set', async () => {
      const { result } = renderUpdateDSLModal()

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as AsyncFn)()
      })

      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
    })
  })
})
