import { act, renderHook } from '@testing-library/react'
import { sseGet } from '@/service/base'
import { submitHumanInputForm } from '@/service/workflow'
import { useChat } from '../hooks'

const mockHandleRun = vi.hoisted(() => vi.fn())
const mockFetchInspectVars = vi.hoisted(() => vi.fn())
const mockInvalidAllLastRun = vi.hoisted(() => vi.fn())
const mockSetIterTimes = vi.hoisted(() => vi.fn())
const mockSetLoopTimes = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputForm = vi.hoisted(() => vi.fn())
const mockSseGet = vi.hoisted(() => vi.fn())
const mockGetNodes = vi.hoisted(() => vi.fn(() => [] as Array<{ id: string, type: string, data: Record<string, unknown> }>))

let mockWorkflowRunningData: unknown = null

vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../hooks', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

vi.mock('../../../hooks-store', () => ({
  useHooksStore: () => ({
    configsMap: {
      flowType: 'appFlow',
      flowId: 'flow-1',
    },
  }),
}))

vi.mock('../../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setIterTimes: mockSetIterTimes,
      setLoopTimes: mockSetLoopTimes,
      inputs: {},
      workflowRunningData: mockWorkflowRunningData,
    }),
  }),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
  mockWorkflowRunningData = null
}

describe('useChat', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('resumes the workflow event stream when switching to a sibling with pending human input', async () => {
    let sendCallbacks: {
      onWorkflowStarted: (payload: { workflow_run_id: string, task_id: string, conversation_id: string | null, message_id: string }) => void
      onHumanInputRequired: (payload: { data: { node_id: string, form_token: string } }) => void
      onCompleted: (payload: boolean) => Promise<void>
    }

    mockHandleRun.mockImplementation((_params: unknown, callbacks: typeof sendCallbacks) => {
      sendCallbacks = callbacks
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'workflow-run-1',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'message-1',
      })
    })

    act(() => {
      sendCallbacks.onHumanInputRequired({
        data: { node_id: 'human-node', form_token: 'form-token' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('message-1', {})
    })

    expect(mockSseGet).toHaveBeenCalled()
    expect(sseGet).toBeDefined()
  })

  it('submits human input forms through the workflow service', async () => {
    const { result } = renderHook(() => useChat({}))

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('token-123', { field: 'value' })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-123', { field: 'value' })
    expect(submitHumanInputForm).toBeDefined()
  })

  it('returns the matching custom node for a human input request', () => {
    const node = { id: 'node-1', type: 'custom', data: { title: 'Human Input' } }
    mockGetNodes.mockReturnValue([
      node,
      { id: 'node-2', type: 'custom', data: { title: 'Other' } },
    ])

    const { result } = renderHook(() => useChat({}))

    expect(result.current.getHumanInputNodeData('node-1')).toEqual(node)
    expect(result.current.getHumanInputNodeData('missing')).toBeUndefined()
  })
})
