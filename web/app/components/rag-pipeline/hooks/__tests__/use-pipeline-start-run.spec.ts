import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { createDeferred } from '@/test/deferred'
import { usePipelineStartRunByCanEdit } from '../use-pipeline-start-run'

const mockWorkflowStoreGetState = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
    setState: mockWorkflowStoreSetState,
  }),
}))

const mockHandleCancelDebugAndPreviewPanel = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-panel-interactions', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
}))

vi.mock('../use-input-field-panel', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: vi.fn(),
  }),
}))

describe('usePipelineStartRunByCanEdit', () => {
  const mockSetIsPreparingDataSource = vi.fn()
  const mockSetShowEnvPanel = vi.fn()
  const mockSetShowDebugAndPreviewPanel = vi.fn()

  beforeEach(() => {
    mockWorkflowStoreGetState.mockReturnValue({
      workflowRunningData: undefined,
      isPreparingDataSource: false,
      showDebugAndPreviewPanel: false,
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
      setShowEnvPanel: mockSetShowEnvPanel,
      setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
    })

    mockDoSyncWorkflowDraft.mockResolvedValue(undefined)
  })

  describe('handleWorkflowStartRunInWorkflow', () => {
    it('should not proceed when workflow is already running', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: {
          result: { status: WorkflowRunningStatus.Running },
        },
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRunByCanEdit(true))

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockSetShowEnvPanel).not.toHaveBeenCalled()
      expect(mockDoSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockWorkflowStoreSetState).not.toHaveBeenCalled()
    })

    it('should set preparing data source when not preparing and has running data', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: {
          result: { status: WorkflowRunningStatus.Succeeded },
        },
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRunByCanEdit(true))

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
        isPreparingDataSource: true,
        workflowRunningData: undefined,
      })
    })

    it('should cancel debug panel when already showing', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: undefined,
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: true,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRunByCanEdit(true))

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
      expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalled()
    })

    it('should wait for draft synchronization before showing datasource preparation', async () => {
      const pending = createDeferred<void>()
      mockDoSyncWorkflowDraft.mockReturnValue(pending.promise)
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: undefined,
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRunByCanEdit(true))

      let running: Promise<void>
      act(() => {
        running = result.current.handleWorkflowStartRunInWorkflow()
      })
      expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
      expect(mockSetIsPreparingDataSource).not.toHaveBeenCalled()
      expect(mockSetShowDebugAndPreviewPanel).not.toHaveBeenCalled()
      await act(async () => {
        pending.resolve()
        await running
      })

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalledOnce()
      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(true)
      expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    })
  })

  describe('handleStartWorkflowRun', () => {
    it('should call handleWorkflowStartRunInWorkflow', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: undefined,
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRunByCanEdit(true))

      await act(async () => {
        result.current.handleStartWorkflowRun()
      })

      expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    })
  })
})
