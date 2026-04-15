import { act } from '@testing-library/react'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { ControlMode } from '../../types'
import {
  useWorkflowInteractions,
  useWorkflowMoveMode,
} from '../use-workflow-panel-interactions'

const mockHandleSelectionCancel = vi.hoisted(() => vi.fn())
const mockHandleNodeCancelRunningStatus = vi.hoisted(() => vi.fn())
const mockHandleEdgeCancelRunningStatus = vi.hoisted(() => vi.fn())

const runtimeState = vi.hoisted(() => ({
  nodesReadOnly: false,
}))

vi.mock('../use-workflow', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: () => runtimeState.nodesReadOnly,
    nodesReadOnly: runtimeState.nodesReadOnly,
  }),
}))

vi.mock('../use-selection-interactions', () => ({
  useSelectionInteractions: () => ({
    handleSelectionCancel: (...args: unknown[]) => mockHandleSelectionCancel(...args),
  }),
}))

vi.mock('../use-nodes-interactions-without-sync', () => ({
  useNodesInteractionsWithoutSync: () => ({
    handleNodeCancelRunningStatus: (...args: unknown[]) => mockHandleNodeCancelRunningStatus(...args),
  }),
}))

vi.mock('../use-edges-interactions-without-sync', () => ({
  useEdgesInteractionsWithoutSync: () => ({
    handleEdgeCancelRunningStatus: (...args: unknown[]) => mockHandleEdgeCancelRunningStatus(...args),
  }),
}))

describe('useWorkflowInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.nodesReadOnly = false
  })

  it('closes the debug panel and clears running state', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowInteractions(), {
      initialStoreState: {
        showDebugAndPreviewPanel: true,
        workflowRunningData: { task_id: 'task-1' } as never,
      },
    })

    act(() => {
      result.current.handleCancelDebugAndPreviewPanel()
    })

    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(store.getState().workflowRunningData).toBeUndefined()
    expect(mockHandleNodeCancelRunningStatus).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeCancelRunningStatus).toHaveBeenCalledTimes(1)
  })
})

describe('useWorkflowMoveMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.nodesReadOnly = false
  })

  it('switches between hand and pointer modes when editable', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowMoveMode(), {
      initialStoreState: {
        controlMode: ControlMode.Pointer,
      },
    })

    act(() => {
      result.current.handleModeHand()
    })

    expect(store.getState().controlMode).toBe(ControlMode.Hand)
    expect(mockHandleSelectionCancel).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.handleModePointer()
    })

    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
  })

  it('does not switch modes when nodes are read-only', () => {
    runtimeState.nodesReadOnly = true
    const { result, store } = renderWorkflowHook(() => useWorkflowMoveMode(), {
      initialStoreState: {
        controlMode: ControlMode.Pointer,
      },
    })

    act(() => {
      result.current.handleModeHand()
      result.current.handleModePointer()
    })

    expect(store.getState().controlMode).toBe(ControlMode.Pointer)
    expect(mockHandleSelectionCancel).not.toHaveBeenCalled()
  })
})
