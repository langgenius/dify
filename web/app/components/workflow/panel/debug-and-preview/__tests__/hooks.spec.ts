import type { useWorkflowRun } from '../../../hooks/use-workflow-run'
import type { Node } from '../../../types'
import { act } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '../../../hooks-store'
import { BlockEnum, WorkflowRunningStatus } from '../../../types'
import { useChat } from '../hooks'

type HandleRun = ReturnType<typeof useWorkflowRun>['handleRun']
type RunCallbacks = NonNullable<Parameters<HandleRun>[1]>

const mockHandleRun = vi.hoisted(() => vi.fn<HandleRun>())
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

const renderChat = (
  options: {
    canRun?: boolean
    nodes?: Node[]
  } = {},
) =>
  renderWorkflowCanvasHook(() => useChat({}), {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    nodes: options.nodes,
    hooksStoreProps: {
      handleRun: mockHandleRun,
      fetchInspectVars: mockFetchInspectVars,
      accessControl: { ...fullWorkflowAccessControl, canRun: options.canRun ?? true },
    },
  })

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resumes a pending-human-input sibling and reflects the responding lifecycle', async () => {
    let sendCallbacks: RunCallbacks | undefined
    mockHandleRun.mockImplementation((_params, callbacks) => {
      sendCallbacks = callbacks
    })
    const { result, store } = renderChat()

    act(() => {
      result.current.handleSend({ query: 'Review this request' }, {})
    })

    expect(result.current.isResponding).toBe(true)
    expect(result.current.chatList).toEqual([
      expect.objectContaining({ content: 'Review this request', isAnswer: false }),
      expect.objectContaining({ content: '', isAnswer: true }),
    ])

    act(() => {
      sendCallbacks!.onWorkflowStarted?.({
        workflow_run_id: 'workflow-run-1',
        task_id: 'task-1',
        event: 'workflow_started',
        data: { id: 'workflow-run-1', workflow_id: 'workflow-1', created_at: 0 },
        conversation_id: undefined,
        message_id: 'message-1',
      })
      sendCallbacks!.onHumanInputRequired?.({
        task_id: 'task-1',
        workflow_run_id: 'workflow-run-1',
        event: 'human_input_required',
        data: {
          form_id: 'form-1',
          node_id: 'human-node',
          node_title: 'Approval',
          form_content: 'Approve this request',
          inputs: [],
          actions: [],
          form_token: 'form-token',
          resolved_default_values: {},
          display_in_ui: true,
          expiration_time: null,
        },
      })
    })
    act(() => {
      store.setState({
        workflowRunningData: {
          task_id: 'task-1',
          tracing: [],
          result: {
            status: WorkflowRunningStatus.Paused,
            inputs_truncated: false,
            process_data_truncated: false,
            outputs_truncated: false,
          },
        },
      })
    })
    await act(async () => {
      await sendCallbacks!.onCompleted?.(false)
    })

    expect(result.current.isResponding).toBe(false)
    expect(result.current.chatList).toEqual([
      expect.objectContaining({ content: 'Review this request', isAnswer: false }),
      expect.objectContaining({
        id: 'message-1',
        workflow_run_id: 'workflow-run-1',
        humanInputFormDataList: [
          expect.objectContaining({ node_id: 'human-node', form_token: 'form-token' }),
        ],
      }),
    ])

    act(() => {
      result.current.handleSwitchSibling('message-1', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/workflow-run-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ onCompleted: expect.any(Function), onData: expect.any(Function) }),
    )
    const resumeCallbacks = mockSseGet.mock.lastCall![2] as RunCallbacks

    act(() => {
      resumeCallbacks.onWorkflowStarted?.({
        workflow_run_id: 'workflow-run-1',
        task_id: 'task-2',
        event: 'workflow_started',
        data: { id: 'workflow-run-1', workflow_id: 'workflow-1', created_at: 0 },
        conversation_id: undefined,
        message_id: 'message-1',
      })
    })
    expect(result.current.isResponding).toBe(true)

    act(() => {
      store.setState({ workflowRunningData: undefined })
    })
    await act(async () => {
      await resumeCallbacks.onCompleted?.(false)
    })

    expect(result.current.isResponding).toBe(false)
    expect(mockFetchInspectVars).toHaveBeenCalledWith({})
    expect(mockInvalidAllLastRun).toHaveBeenCalledOnce()
  })

  it('does not create chat state or start a run without run permission', () => {
    const { result } = renderChat({ canRun: false })

    let accepted: boolean | undefined
    act(() => {
      accepted = result.current.handleSend({ query: 'Blocked request' }, {})
    })

    expect(accepted).toBe(false)
    expect(result.current.isResponding).toBe(false)
    expect(result.current.chatList).toEqual([])
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('submits human input forms through the workflow service', async () => {
    const { result } = renderChat()

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
    const { result } = renderChat({ nodes: [node, createNode({ id: 'node-2' })] })

    expect(result.current.getHumanInputNodeData('node-1')).toMatchObject(node)
    expect(result.current.getHumanInputNodeData('missing')).toBeUndefined()
  })
})
