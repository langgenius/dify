import { act } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowHook as renderHook } from '../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../types'
import { useChat } from '../hooks'

const mockHandleRun = vi.hoisted(() => vi.fn())
const mockFetchInspectVars = vi.hoisted(() => vi.fn())
const mockInvalidAllLastRun = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputForm = vi.hoisted(() => vi.fn())
const mockSseGet = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
}))

vi.mock('../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
}

describe('useChat', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('resumes the workflow event stream when switching to a sibling with pending human input', async () => {
    let sendCallbacks: {
      onWorkflowStarted: (payload: {
        workflow_run_id: string
        task_id: string
        conversation_id: string | null
        message_id: string
      }) => void
      onHumanInputRequired: (payload: { data: { node_id: string; form_token: string } }) => void
      onCompleted: (payload: boolean) => Promise<void>
    }

    mockHandleRun.mockImplementation((_params: unknown, callbacks: typeof sendCallbacks) => {
      sendCallbacks = callbacks
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/workflow-run-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ onCompleted: expect.any(Function), onData: expect.any(Function) }),
    )
  })

  it('submits human input forms through the workflow service', async () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('token-123', {
        inputs: { field: 'value' },
        action: 'approve',
      })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-123', {
      inputs: { field: 'value' },
      action: 'approve',
    })
  })

  it('returns the matching custom node for a human input request', () => {
    const node = createNode({
      id: 'node-1',
      data: { type: BlockEnum.HumanInput, title: 'Human Input' },
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      nodes: [node, createNode({ id: 'node-2' })],
    })

    expect(result.current.getHumanInputNodeData('node-1')).toMatchObject(node)
    expect(result.current.getHumanInputNodeData('missing')).toBeUndefined()
  })
})
