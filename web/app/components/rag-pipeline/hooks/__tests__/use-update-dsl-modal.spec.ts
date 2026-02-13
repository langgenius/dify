import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { useUpdateDSLModal } from '../use-update-dsl-modal'

class MockFileReader {
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => void) | null = null

  readAsText(_file: Blob) {
    const event = { target: { result: 'test content' } } as unknown as ProgressEvent<FileReader>
    this.onload?.call(this as unknown as FileReader, event)
  }
}
vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)

const mockNotify = vi.fn()
const mockEmit = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()

vi.mock('use-context-selector', () => ({
  useContext: () => ({ notify: mockNotify }),
}))

vi.mock('@/app/components/base/toast', () => ({
  ToastContext: {},
}))

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

vi.mock('@/app/components/workflow/utils', () => ({
  initialNodes: (nodes: unknown[]) => nodes,
  initialEdges: (edges: unknown[]) => edges,
}))

vi.mock('@/app/components/workflow/constants', () => ({
  WORKFLOW_DATA_UPDATE: 'WORKFLOW_DATA_UPDATE',
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/service/use-pipeline', () => ({
  useImportPipelineDSL: () => ({ mutateAsync: mockImportDSL }),
  useImportPipelineDSLConfirm: () => ({ mutateAsync: mockImportDSLConfirm }),
}))

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
    renderHook(() =>
      useUpdateDSLModal({
        onCancel: mockOnCancel,
        onImport: overrides?.onImport ?? mockOnImport,
      }),
    )

  beforeEach(() => {
    vi.clearAllMocks()
    mockImportDSL.mockResolvedValue({
      id: 'import-id',
      status: DSLImportStatus.COMPLETED,
      pipeline_id: 'test-pipeline-id',
    })
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
  })

  describe('initial state', () => {
    it('should return correct defaults', () => {
      const { result } = renderUpdateDSLModal()

      expect(result.current.currentFile).toBeUndefined()
      expect(result.current.show).toBe(true)
      expect(result.current.showErrorModal).toBe(false)
      expect(result.current.loading).toBe(false)
      expect(result.current.versions).toBeUndefined()
    })
  })

  describe('handleFile', () => {
    it('should set currentFile when file is provided', () => {
      const { result } = renderUpdateDSLModal()
      const file = createFile()

      act(() => {
        result.current.handleFile(file)
      })

      expect(result.current.currentFile).toBe(file)
    })

    it('should clear currentFile when called with undefined', () => {
      const { result } = renderUpdateDSLModal()

      act(() => {
        result.current.handleFile(createFile())
      })
      act(() => {
        result.current.handleFile(undefined)
      })

      expect(result.current.currentFile).toBeUndefined()
    })
  })

  describe('modal state', () => {
    it('should allow toggling showErrorModal', () => {
      const { result } = renderUpdateDSLModal()

      expect(result.current.showErrorModal).toBe(false)

      act(() => {
        result.current.setShowErrorModal(true)
      })
      expect(result.current.showErrorModal).toBe(true)

      act(() => {
        result.current.setShowErrorModal(false)
      })
      expect(result.current.showErrorModal).toBe(false)
    })
  })

  describe('handleImport', () => {
    it('should call importDSL with correct parameters', async () => {
      const { result } = renderUpdateDSLModal()

      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockImportDSL).toHaveBeenCalledWith({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: 'test content',
        pipeline_id: 'test-pipeline-id',
      })
    })

    it('should not call importDSL when no file is selected', async () => {
      const { result } = renderUpdateDSLModal()

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockImportDSL).not.toHaveBeenCalled()
    })

    it('should notify success on COMPLETED status', async () => {
      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    })

    it('should call onImport on successful import', async () => {
      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockOnImport).toHaveBeenCalled()
    })

    it('should call onCancel on successful import', async () => {
      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should emit workflow update event on success', async () => {
      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockEmit).toHaveBeenCalled()
    })

    it('should call handleCheckPluginDependencies on success', async () => {
      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('test-pipeline-id', true)
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
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }))
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
        await (result.current.handleImport as unknown as AsyncFn)()
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

    it('should default version strings to empty when undefined', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.PENDING,
        pipeline_id: 'test-pipeline-id',
        imported_dsl_version: undefined,
        current_dsl_version: undefined,
      })

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
        await vi.advanceTimersByTimeAsync(350)
      })

      expect(result.current.versions).toEqual({
        importedVersion: '',
        systemVersion: '',
      })

      vi.useRealTimers()
    })

    it('should notify error on FAILED status', async () => {
      mockImportDSL.mockResolvedValue({
        id: 'import-id',
        status: DSLImportStatus.FAILED,
        pipeline_id: 'test-pipeline-id',
      })

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should notify error when importDSL throws', async () => {
      mockImportDSL.mockRejectedValue(new Error('Network error'))

      const { result } = renderUpdateDSLModal()
      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
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
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
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
        await (result.current.handleImport as unknown as AsyncFn)()
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
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockImportDSLConfirm).toHaveBeenCalledWith('import-id')
    })

    it('should notify success and call onCancel after successful confirm', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
      expect(mockOnCancel).toHaveBeenCalled()
    })

    it('should call onImport after successful confirm', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: 'test-pipeline-id',
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockOnImport).toHaveBeenCalled()
    })

    it('should notify error on FAILED confirm status', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.FAILED,
        pipeline_id: 'test-pipeline-id',
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should notify error when confirm throws exception', async () => {
      mockImportDSLConfirm.mockRejectedValue(new Error('Confirm failed'))

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should notify error when confirm succeeds but pipeline_id is missing', async () => {
      mockImportDSLConfirm.mockResolvedValue({
        status: DSLImportStatus.COMPLETED,
        pipeline_id: undefined,
      })

      const { result } = renderUpdateDSLModal()
      await setupPendingState(result)

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should not call importDSLConfirm when importId is not set', async () => {
      const { result } = renderUpdateDSLModal()

      await act(async () => {
        await (result.current.onUpdateDSLConfirm as unknown as AsyncFn)()
      })

      expect(mockImportDSLConfirm).not.toHaveBeenCalled()
    })
  })

  describe('optional onImport', () => {
    it('should work without onImport callback', async () => {
      const { result } = renderHook(() =>
        useUpdateDSLModal({ onCancel: mockOnCancel }),
      )

      act(() => {
        result.current.handleFile(createFile())
      })

      await act(async () => {
        await (result.current.handleImport as unknown as AsyncFn)()
      })

      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})
