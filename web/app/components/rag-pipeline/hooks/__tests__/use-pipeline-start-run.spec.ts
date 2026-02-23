import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

import { usePipelineStartRun } from '../use-pipeline-start-run'

const mockWorkflowStoreGetState = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
    setState: mockWorkflowStoreSetState,
  }),
}))

const mockHandleCancelDebugAndPreviewPanel = vi.fn()
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

const mockDoSyncWorkflowDraft = vi.fn()
vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: vi.fn(),
  }),
}))

describe('usePipelineStartRun', () => {
  const mockSetIsPreparingDataSource = vi.fn()
  const mockSetShowEnvPanel = vi.fn()
  const mockSetShowDebugAndPreviewPanel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

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

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook initialization', () => {
    it('should return handleStartWorkflowRun function', () => {
      const { result } = renderHook(() => usePipelineStartRun())

      expect(result.current.handleStartWorkflowRun).toBeDefined()
      expect(typeof result.current.handleStartWorkflowRun).toBe('function')
    })

    it('should return handleWorkflowStartRunInWorkflow function', () => {
      const { result } = renderHook(() => usePipelineStartRun())

      expect(result.current.handleWorkflowStartRunInWorkflow).toBeDefined()
      expect(typeof result.current.handleWorkflowStartRunInWorkflow).toBe('function')
    })
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

      const { result } = renderHook(() => usePipelineStartRun())

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockSetShowEnvPanel).not.toHaveBeenCalled()
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

      const { result } = renderHook(() => usePipelineStartRun())

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

      const { result } = renderHook(() => usePipelineStartRun())

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
      expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalled()
    })

    it('should sync draft and show debug panel when conditions are met', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: undefined,
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRun())

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockDoSyncWorkflowDraft).toHaveBeenCalled()
      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(true)
      expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    })

    it('should hide env panel at start', async () => {
      mockWorkflowStoreGetState.mockReturnValue({
        workflowRunningData: undefined,
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        setIsPreparingDataSource: mockSetIsPreparingDataSource,
        setShowEnvPanel: mockSetShowEnvPanel,
        setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      })

      const { result } = renderHook(() => usePipelineStartRun())

      await act(async () => {
        await result.current.handleWorkflowStartRunInWorkflow()
      })

      expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
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

      const { result } = renderHook(() => usePipelineStartRun())

      await act(async () => {
        result.current.handleStartWorkflowRun()
      })

      expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    })
  })
})
