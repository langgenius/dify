import type { QueryClient } from '@tanstack/react-query'
import type { useWorkflowRun } from '../../../hooks/use-workflow-run'
import type { Node } from '../../../types'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkflowProcessItem from '@/app/components/base/chat/chat/answer/workflow-process'
import { lastRunQueryKey } from '@/service/workflow-queries'
import { createTestQueryClient } from '@/test/query-client'
import { createNode, createNodeTracing } from '../../../__tests__/fixtures'
import {
  renderWorkflowCanvasHook,
  renderWorkflowComponent,
} from '../../../__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '../../../hooks-store'
import { BlockEnum, WorkflowRunningStatus } from '../../../types'
import { useChat } from '../hooks'

type HandleRun = ReturnType<typeof useWorkflowRun>['handleRun']
type RunCallbacks = NonNullable<Parameters<HandleRun>[1]>

const mockHandleRun = vi.hoisted(() => vi.fn<HandleRun>())
const mockFetchInspectVars = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputForm = vi.hoisted(() => vi.fn())
const mockStreamEvents = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mockRequest,
}))

vi.mock('@/service/event-stream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/event-stream')>()),
  streamEvents: (...args: unknown[]) => mockStreamEvents(...args),
}))

// Tags each resume request with its run id; workflow-events.spec covers the request itself.
vi.mock('@/service/workflow-events', () => ({
  workflowRunEventsRequest: (workflowRunId: string) => ({ workflowRunId }),
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

const renderChat = (
  options: {
    canRun?: boolean
    nodes?: Node[]
    mode?: 'workflow' | 'advanced-chat'
    queryClient?: QueryClient
  } = {},
) =>
  renderWorkflowCanvasHook(() => useChat({}), {
    queryClient: options.queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: options.mode ?? 'workflow' },
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
    const queryClient = createTestQueryClient()
    const lastRunKey = lastRunQueryKey(
      { kind: 'app', collaborationEnabled: false, appId: 'app-1', mode: 'workflow' },
      'human-node',
    )
    const otherAppLastRunKey = lastRunQueryKey(
      { kind: 'app', collaborationEnabled: false, appId: 'app-2', mode: 'workflow' },
      'human-node',
    )
    queryClient.setQueryData(lastRunKey, { id: 'run-1' })
    queryClient.setQueryData(otherAppLastRunKey, { id: 'run-2' })
    const { result, store } = renderChat({ queryClient })

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
    // A paused run keeps cached last-run results until it actually completes.
    expect(queryClient.getQueryState(lastRunKey)?.isInvalidated).toBe(false)
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

    expect(mockStreamEvents).toHaveBeenCalledWith(
      { workflowRunId: 'workflow-run-1' },
      expect.objectContaining({ onCompleted: expect.any(Function), onData: expect.any(Function) }),
    )
    const resumeCallbacks = mockStreamEvents.mock.lastCall![1] as RunCallbacks

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
    expect(queryClient.getQueryState(lastRunKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(otherAppLastRunKey)?.isInvalidated).toBe(false)
  })

  it('keeps workflow-tool tracing available after resuming a sibling with pending human input', async () => {
    const user = userEvent.setup()
    let sendCallbacks: RunCallbacks | undefined
    let resumeCallbacks: RunCallbacks | undefined
    mockHandleRun.mockImplementation((_params, callbacks) => {
      sendCallbacks = callbacks
    })
    mockStreamEvents.mockImplementation((_request: unknown, callbacks: RunCallbacks) => {
      resumeCallbacks = callbacks
    })
    mockRequest.mockImplementation(() => Promise.resolve(Response.json({ data: [] })))
    const envelope = { task_id: 'task-1', workflow_run_id: 'workflow-run-1' }
    const started = {
      ...envelope,
      event: 'workflow_started',
      message_id: 'message-1',
      data: { id: 'workflow-run-1', workflow_id: 'workflow-1', created_at: 1 },
    }
    const tool = createNodeTracing({
      id: 'tool-execution',
      node_id: 'tool-node',
      node_type: BlockEnum.Tool,
      title: 'Downstream workflow tool',
    })
    const { result } = renderChat({ mode: 'advanced-chat' })

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })
    act(() => {
      sendCallbacks!.onWorkflowStarted!(started)
      sendCallbacks!.onHumanInputRequired!({
        ...envelope,
        event: 'human_input_required',
        data: {
          form_id: 'form-1',
          node_id: 'human-node',
          node_title: 'Human approval',
          form_content: 'Approve this workflow?',
          form_token: 'form-token',
          inputs: [],
          actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
          resolved_default_values: {},
          display_in_ui: true,
          expiration_time: null,
        },
      })
      sendCallbacks!.onWorkflowPaused!({
        ...envelope,
        event: 'workflow_paused',
        data: {
          workflow_run_id: envelope.workflow_run_id,
          paused_nodes: ['human-node'],
          reasons: [],
          outputs: {},
        },
      })
    })
    await act(async () => {
      await sendCallbacks!.onCompleted!(false)
    })
    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })
    act(() => {
      sendCallbacks!.onWorkflowStarted!({
        ...started,
        workflow_run_id: 'workflow-run-2',
        task_id: 'task-2',
        message_id: 'message-2',
        data: { ...started.data, id: 'workflow-run-2' },
      })
    })
    await act(async () => {
      await sendCallbacks!.onCompleted!(false)
    })
    act(() => {
      result.current.handleSwitchSibling('message-1', {})
    })

    expect(mockStreamEvents).toHaveBeenCalledWith(
      { workflowRunId: 'workflow-run-1' },
      expect.objectContaining({ onCompleted: expect.any(Function), onData: expect.any(Function) }),
    )
    act(() => {
      resumeCallbacks!.onWorkflowStarted!(started)
      resumeCallbacks!.onHumanInputFormFilled!({
        ...envelope,
        event: 'human_input_form_filled',
        data: {
          form_id: 'form-1',
          node_id: 'human-node',
          node_title: 'Human approval',
          rendered_content: 'Approve this workflow?',
          action_id: 'approve',
          action_text: 'Approve',
        },
      })
      resumeCallbacks!.onNodeStarted!({
        ...envelope,
        event: 'node_started',
        data: {
          ...tool,
          extras: { workflow_tool: true, icon: { content: '✅', background: '#fff' } },
        },
      })
      resumeCallbacks!.onNodeFinished!({
        ...envelope,
        event: 'node_finished',
        data: { ...tool, status: 'succeeded', elapsed_time: 1, finished_at: 2 },
      })
      resumeCallbacks!.onWorkflowFinished!({
        ...envelope,
        event: 'workflow_finished',
        data: {
          ...started.data,
          status: 'succeeded',
          outputs: {},
          error: '',
          elapsed_time: 1,
          total_tokens: 0,
          total_steps: 2,
          created_by: tool.created_by,
          finished_at: 2,
        },
      })
    })
    await act(async () => {
      await resumeCallbacks!.onCompleted!(false)
    })

    const answer = result.current.chatList.find((item) => item.id === 'message-1')!
    renderWorkflowComponent(
      <WorkflowProcessItem item={answer} data={answer.workflowProcess!} expand />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' } },
    )
    expect(
      screen.getByRole('img', { name: 'workflow.common.workflowProcessSucceeded' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Downstream workflow tool/ }))
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(await screen.findByText('common.noData')).toBeVisible()
    expect(mockRequest).toHaveBeenCalledWith(
      expect.stringContaining(
        '/apps/app-1/workflow-runs/workflow-run-1/node-executions/tool-execution/children',
      ),
      expect.anything(),
      expect.anything(),
    )
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

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith(
      'token-123',
      {
        inputs: { field: 'value' },
        action: 'approve',
      },
      undefined,
    )
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
