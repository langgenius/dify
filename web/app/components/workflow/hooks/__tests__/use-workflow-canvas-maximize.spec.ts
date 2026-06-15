import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import { useWorkflowCanvasMaximize } from '../use-workflow-canvas-maximize'

const mockEmit = vi.hoisted(() => vi.fn())

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

describe('useWorkflowCanvasMaximize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('toggles maximize state, persists it, and emits the canvas event', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowCanvasMaximize(), {
      initialStoreState: {
        maximizeCanvas: false,
      },
    })

    result.current.handleToggleMaximizeCanvas()

    expect(store.getState().maximizeCanvas).toBe(true)
    expect(localStorage.getItem('workflow-canvas-maximize')).toBe('true')
    expect(mockEmit).toHaveBeenCalledWith({
      type: 'workflow-canvas-maximize',
      payload: true,
    })
  })

  it('does nothing while workflow nodes are read-only', () => {
    const { result, store } = renderWorkflowHook(() => useWorkflowCanvasMaximize(), {
      initialStoreState: {
        maximizeCanvas: false,
        workflowRunningData: {
          result: {
            status: WorkflowRunningStatus.Running,
            inputs_truncated: false,
            process_data_truncated: false,
            outputs_truncated: false,
          },
        },
      },
    })

    result.current.handleToggleMaximizeCanvas()

    expect(store.getState().maximizeCanvas).toBe(false)
    expect(localStorage.getItem('workflow-canvas-maximize')).toBeNull()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
