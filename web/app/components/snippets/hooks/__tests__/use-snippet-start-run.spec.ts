import type { SnippetInputField } from '@/models/snippet'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetStartRun } from '../use-snippet-start-run'

const mockWorkflowStoreGetState = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockWorkflowStoreGetState,
  }),
}))

const mockHandleCancelDebugAndPreviewPanel = vi.fn()
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

const mockSetShowDebugAndPreviewPanel = vi.fn()
const mockSetShowInputsPanel = vi.fn()
const mockSetShowEnvPanel = vi.fn()
const mockSetShowGlobalVariablePanel = vi.fn()
const mockHandleRun = vi.fn()

const inputFields: SnippetInputField[] = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
  },
]

describe('useSnippetStartRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStoreGetState.mockReturnValue({
      workflowRunningData: undefined,
      showDebugAndPreviewPanel: false,
      setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      setShowInputsPanel: mockSetShowInputsPanel,
      setShowEnvPanel: mockSetShowEnvPanel,
      setShowGlobalVariablePanel: mockSetShowGlobalVariablePanel,
    })
  })

  it('should open the debug panel and input form when snippet has input fields', () => {
    const { result } = renderHook(() => useSnippetStartRun({
      handleRun: mockHandleRun,
      inputFields,
    }))

    act(() => {
      result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowGlobalVariablePanel).toHaveBeenCalledWith(false)
    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(true)
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('should run immediately when snippet has no input fields', () => {
    const { result } = renderHook(() => useSnippetStartRun({
      handleRun: mockHandleRun,
      inputFields: [],
    }))

    act(() => {
      result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowInputsPanel).toHaveBeenCalledWith(false)
    expect(mockHandleRun).toHaveBeenCalledWith({ inputs: {} })
  })

  it('should close the panel when debug panel is already open', () => {
    mockWorkflowStoreGetState.mockReturnValue({
      workflowRunningData: undefined,
      showDebugAndPreviewPanel: true,
      setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      setShowInputsPanel: mockSetShowInputsPanel,
      setShowEnvPanel: mockSetShowEnvPanel,
      setShowGlobalVariablePanel: mockSetShowGlobalVariablePanel,
    })

    const { result } = renderHook(() => useSnippetStartRun({
      handleRun: mockHandleRun,
      inputFields,
    }))

    act(() => {
      result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalled()
  })

  it('should do nothing when workflow is already running', () => {
    mockWorkflowStoreGetState.mockReturnValue({
      workflowRunningData: {
        result: {
          status: WorkflowRunningStatus.Running,
        },
      },
      showDebugAndPreviewPanel: false,
      setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
      setShowInputsPanel: mockSetShowInputsPanel,
      setShowEnvPanel: mockSetShowEnvPanel,
      setShowGlobalVariablePanel: mockSetShowGlobalVariablePanel,
    })

    const { result } = renderHook(() => useSnippetStartRun({
      handleRun: mockHandleRun,
      inputFields,
    }))

    act(() => {
      result.current.handleWorkflowStartRunInWorkflow()
    })

    expect(mockSetShowDebugAndPreviewPanel).not.toHaveBeenCalled()
    expect(mockHandleRun).not.toHaveBeenCalled()
  })
})
