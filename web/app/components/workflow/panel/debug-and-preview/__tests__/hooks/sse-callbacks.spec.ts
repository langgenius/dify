/* eslint-disable ts/no-explicit-any */
import { act, renderHook } from '@testing-library/react'
import { useChat } from '../../hooks'

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSetIterTimes = vi.fn()
const mockSetLoopTimes = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
const mockGetNodes = vi.fn((): any[] => [])

let mockWorkflowRunningData: any = null

vi.mock('@/service/base', () => ({
  sseGet: (...args: any[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: any[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: any[]) => mockNotify(...args),
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../../hooks', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

vi.mock('../../../../hooks-store', () => ({
  useHooksStore: () => null,
}))

vi.mock('../../../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setIterTimes: mockSetIterTimes,
      setLoopTimes: mockSetLoopTimes,
      inputs: {},
      workflowRunningData: mockWorkflowRunningData,
    }),
  }),
  useStore: () => vi.fn(),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
  mockWorkflowRunningData = null
}

describe('useChat – handleSend SSE callbacks', () => {
  let capturedCallbacks: any

  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      capturedCallbacks = callbacks
    })
  })

  function setupAndSend(config: any = {}) {
    const hook = renderHook(() => useChat(config))
    act(() => {
      hook.result.current.handleSend({ query: 'test' }, {
        onGetSuggestedQuestions: vi.fn().mockResolvedValue({ data: ['q1'] }),
      })
    })
    return hook
  }

  function startWorkflow(overrides: Record<string, any> = {}) {
    act(() => {
      capturedCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: null,
        message_id: null,
        ...overrides,
      })
    })
  }

  function startNode(nodeId: string, traceId: string, extra: Record<string, any> = {}) {
    act(() => {
      capturedCallbacks.onNodeStarted({
        data: { node_id: nodeId, id: traceId, ...extra },
      })
    })
  }

  describe('onData', () => {
    it('should append message content', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('Hello', true, {
          conversationId: 'conv-1',
          messageId: 'msg-1',
          taskId: 'task-1',
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.content).toContain('Hello')
    })

    it('should set response id from messageId on first call', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('Hi', true, {
          conversationId: 'conv-1',
          messageId: 'msg-123',
          taskId: 'task-1',
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-123')
      expect(answer).toBeDefined()
    })

    it('should set conversationId on first message with newConversationId', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('Hi', true, {
          conversationId: 'new-conv-id',
          messageId: 'msg-1',
          taskId: 'task-1',
        })
      })

      expect(result.current.conversationId).toBe('new-conv-id')
    })

    it('should not set conversationId when isFirstMessage is false', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('Hi', false, {
          conversationId: 'conv-should-not-set',
          messageId: 'msg-1',
          taskId: 'task-1',
        })
      })

      expect(result.current.conversationId).toBe('')
    })

    it('should not update hasSetResponseId when messageId is empty', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('msg1', true, {
          conversationId: '',
          messageId: '',
          taskId: 'task-1',
        })
      })

      act(() => {
        capturedCallbacks.onData('msg2', false, {
          conversationId: '',
          messageId: 'late-id',
          taskId: 'task-1',
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'late-id')
      expect(answer).toBeDefined()
    })

    it('should only set hasSetResponseId once', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('msg1', true, {
          conversationId: 'c1',
          messageId: 'msg-first',
          taskId: 'task-1',
        })
      })

      act(() => {
        capturedCallbacks.onData('msg2', false, {
          conversationId: 'c1',
          messageId: 'msg-second',
          taskId: 'task-1',
        })
      })

      const question = result.current.chatList.find(item => !item.isAnswer)
      expect(question!.id).toBe('question-msg-first')
    })
  })

  describe('onCompleted', () => {
    it('should set isResponding to false', async () => {
      const { result } = setupAndSend()
      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })
      expect(result.current.isResponding).toBe(false)
    })

    it('should call fetchInspectVars and invalidAllLastRun when not paused', async () => {
      setupAndSend()
      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })
      expect(mockFetchInspectVars).toHaveBeenCalledWith({})
      expect(mockInvalidAllLastRun).toHaveBeenCalled()
    })

    it('should not call fetchInspectVars when workflow is paused', async () => {
      mockWorkflowRunningData = { result: { status: 'paused' } }
      setupAndSend()
      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })
      expect(mockFetchInspectVars).not.toHaveBeenCalled()
    })

    it('should set error content on response item when hasError with errorMessage', async () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('partial', true, {
          conversationId: 'c1',
          messageId: 'msg-err',
          taskId: 't1',
        })
      })

      await act(async () => {
        await capturedCallbacks.onCompleted(true, 'Something went wrong')
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-err')
      expect(answer!.content).toBe('Something went wrong')
      expect(answer!.isError).toBe(true)
    })

    it('should not set error content when hasError is true but errorMessage is empty', async () => {
      const { result } = setupAndSend()
      await act(async () => {
        await capturedCallbacks.onCompleted(true)
      })
      expect(result.current.isResponding).toBe(false)
    })

    it('should fetch suggested questions when enabled and invoke abort controller callback', async () => {
      const mockGetSuggested = vi.fn().mockImplementation((_id: string, getAbortCtrl: any) => {
        getAbortCtrl(new AbortController())
        return Promise.resolve({ data: ['suggestion1'] })
      })
      const hook = renderHook(() =>
        useChat({ suggested_questions_after_answer: { enabled: true } }),
      )

      mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
        capturedCallbacks = callbacks
      })

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {
          onGetSuggestedQuestions: mockGetSuggested,
        })
      })

      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })

      expect(mockGetSuggested).toHaveBeenCalled()
    })

    it('should set suggestedQuestions to empty array when fetch fails', async () => {
      const mockGetSuggested = vi.fn().mockRejectedValue(new Error('fail'))
      const hook = renderHook(() =>
        useChat({ suggested_questions_after_answer: { enabled: true } }),
      )

      mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
        capturedCallbacks = callbacks
      })

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {
          onGetSuggestedQuestions: mockGetSuggested,
        })
      })

      await act(async () => {
        await capturedCallbacks.onCompleted(false)
      })

      expect(hook.result.current.suggestedQuestions).toEqual([])
    })
  })

  describe('onError', () => {
    it('should set isResponding to false', () => {
      const { result } = setupAndSend()
      act(() => {
        capturedCallbacks.onError()
      })
      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('onMessageEnd', () => {
    it('should update citation and files', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('response', true, {
          conversationId: 'c1',
          messageId: 'msg-1',
          taskId: 't1',
        })
      })

      act(() => {
        capturedCallbacks.onMessageEnd({
          metadata: { retriever_resources: [{ id: 'r1' }] },
          files: [],
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-1')
      expect(answer!.citation).toEqual([{ id: 'r1' }])
    })

    it('should default citation to empty array when no retriever_resources', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('response', true, {
          conversationId: 'c1',
          messageId: 'msg-1',
          taskId: 't1',
        })
      })

      act(() => {
        capturedCallbacks.onMessageEnd({ metadata: {}, files: [] })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-1')
      expect(answer!.citation).toEqual([])
    })
  })

  describe('onMessageReplace', () => {
    it('should replace answer content on responseItem', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onData('old', true, {
          conversationId: 'c1',
          messageId: 'msg-1',
          taskId: 't1',
        })
      })

      act(() => {
        capturedCallbacks.onMessageReplace({ answer: 'replaced' })
      })

      act(() => {
        capturedCallbacks.onMessageEnd({ metadata: {}, files: [] })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-1')
      expect(answer!.content).toBe('replaced')
    })
  })

  describe('onWorkflowStarted', () => {
    it('should create workflow process with Running status', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          message_id: 'msg-1',
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.status).toBe('running')
      expect(answer!.workflowProcess!.tracing).toEqual([])
    })

    it('should set conversationId when provided', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: 'from-workflow',
          message_id: null,
        })
      })

      expect(result.current.conversationId).toBe('from-workflow')
    })

    it('should not override existing conversationId when conversation_id is null', () => {
      const { result } = setupAndSend()
      startWorkflow()
      expect(result.current.conversationId).toBe('')
    })

    it('should resume existing workflow process when tracing exists', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('n1', 'trace-1')
      startWorkflow({ workflow_run_id: 'wfr-2', task_id: 'task-2' })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.status).toBe('running')
      expect(answer!.workflowProcess!.tracing.length).toBe(1)
    })

    it('should replace placeholder answer id with real message_id from server', () => {
      const { result } = setupAndSend()

      act(() => {
        capturedCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: null,
          message_id: 'wf-msg-id',
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'wf-msg-id')
      expect(answer).toBeDefined()
    })
  })

  describe('onWorkflowFinished', () => {
    it('should update workflow process status', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onWorkflowFinished({ data: { status: 'succeeded' } })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.status).toBe('succeeded')
    })
  })

  describe('onIterationStart / onIterationFinish', () => {
    it('should push tracing entry on start', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onIterationStart({
          data: { id: 'iter-1', node_id: 'n-iter' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('iter-1')
      expect(trace.node_id).toBe('n-iter')
      expect(trace.status).toBe('running')
    })

    it('should update matching tracing on finish', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onIterationStart({
          data: { id: 'iter-1', node_id: 'n-iter' },
        })
      })

      act(() => {
        capturedCallbacks.onIterationFinish({
          data: { id: 'iter-1', node_id: 'n-iter', output: 'done' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const trace = answer!.workflowProcess!.tracing.find((t: any) => t.id === 'iter-1')
      expect(trace).toBeDefined()
      expect(trace!.node_id).toBe('n-iter')
      expect((trace as any).output).toBe('done')
    })

    it('should not update tracing on finish when id does not match', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onIterationStart({
          data: { id: 'iter-1', node_id: 'n-iter' },
        })
      })

      act(() => {
        capturedCallbacks.onIterationFinish({
          data: { id: 'iter-nonexistent', node_id: 'n-other' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect((answer!.workflowProcess!.tracing[0] as any).output).toBeUndefined()
    })
  })

  describe('onLoopStart / onLoopFinish', () => {
    it('should push tracing entry on start', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onLoopStart({
          data: { id: 'loop-1', node_id: 'n-loop' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('loop-1')
      expect(trace.node_id).toBe('n-loop')
      expect(trace.status).toBe('running')
    })

    it('should update matching tracing on finish', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onLoopStart({
          data: { id: 'loop-1', node_id: 'n-loop' },
        })
      })

      act(() => {
        capturedCallbacks.onLoopFinish({
          data: { id: 'loop-1', node_id: 'n-loop', output: 'done' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('loop-1')
      expect(trace.node_id).toBe('n-loop')
      expect((trace as any).output).toBe('done')
    })

    it('should not update tracing on finish when id does not match', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onLoopStart({
          data: { id: 'loop-1', node_id: 'n-loop' },
        })
      })

      act(() => {
        capturedCallbacks.onLoopFinish({
          data: { id: 'loop-nonexistent', node_id: 'n-other' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect((answer!.workflowProcess!.tracing[0] as any).output).toBeUndefined()
    })
  })

  describe('onNodeStarted / onNodeRetry / onNodeFinished', () => {
    it('should add new tracing entry', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('trace-1')
      expect(trace.node_id).toBe('node-1')
      expect(trace.status).toBe('running')
    })

    it('should update existing tracing entry with same node_id', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')
      startNode('node-1', 'trace-1-v2')

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('trace-1-v2')
      expect(trace.node_id).toBe('node-1')
      expect(trace.status).toBe('running')
    })

    it('should push retry data to tracing', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onNodeRetry({
          data: { node_id: 'node-1', id: 'retry-1', retry_index: 1 },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('retry-1')
      expect(trace.node_id).toBe('node-1')
      expect((trace as any).retry_index).toBe(1)
    })

    it('should update tracing entry on finish by id', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')

      act(() => {
        capturedCallbacks.onNodeFinished({
          data: { node_id: 'node-1', id: 'trace-1', status: 'succeeded', outputs: { text: 'done' } },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('trace-1')
      expect(trace.status).toBe('succeeded')
      expect((trace as any).outputs).toEqual({ text: 'done' })
    })

    it('should not update tracing on finish when id does not match', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('node-1', 'trace-1')

      act(() => {
        capturedCallbacks.onNodeFinished({
          data: { node_id: 'node-x', id: 'trace-x', status: 'succeeded' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      const trace = answer!.workflowProcess!.tracing[0]
      expect(trace.id).toBe('trace-1')
      expect(trace.status).toBe('running')
    })
  })

  describe('onAgentLog', () => {
    function setupWithNode() {
      const hook = setupAndSend()
      startWorkflow()
      return hook
    }

    it('should create execution_metadata.agent_log when no execution_metadata exists', () => {
      const { result } = setupWithNode()
      startNode('agent-node', 'trace-agent')

      act(() => {
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-1', content: 'init' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const agentTrace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'agent-node')
      expect(agentTrace!.execution_metadata!.agent_log).toHaveLength(1)
    })

    it('should create agent_log array when execution_metadata exists but no agent_log', () => {
      const { result } = setupWithNode()
      startNode('agent-node', 'trace-agent', { execution_metadata: { parallel_id: 'p1' } })

      act(() => {
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-1', content: 'step1' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const agentTrace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'agent-node')
      expect(agentTrace!.execution_metadata!.agent_log).toHaveLength(1)
    })

    it('should update existing agent_log entry by message_id', () => {
      const { result } = setupWithNode()
      startNode('agent-node', 'trace-agent', {
        execution_metadata: { agent_log: [{ message_id: 'log-1', content: 'v1' }] },
      })

      act(() => {
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-1', content: 'v2' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const agentTrace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'agent-node')
      expect(agentTrace!.execution_metadata!.agent_log).toHaveLength(1)
      expect((agentTrace!.execution_metadata!.agent_log as any[])[0].content).toBe('v2')
    })

    it('should push new agent_log entry when message_id does not match', () => {
      const { result } = setupWithNode()
      startNode('agent-node', 'trace-agent', {
        execution_metadata: { agent_log: [{ message_id: 'log-1', content: 'v1' }] },
      })

      act(() => {
        capturedCallbacks.onAgentLog({
          data: { node_id: 'agent-node', message_id: 'log-2', content: 'new' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const agentTrace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'agent-node')
      expect(agentTrace!.execution_metadata!.agent_log).toHaveLength(2)
    })

    it('should not crash when node_id is not found in tracing', () => {
      setupWithNode()

      act(() => {
        capturedCallbacks.onAgentLog({
          data: { node_id: 'nonexistent-node', message_id: 'log-1', content: 'noop' },
        })
      })
    })
  })

  describe('onHumanInputRequired', () => {
    it('should add form data to humanInputFormDataList', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('human-node', 'trace-human')

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node', form_token: 'token-1' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.humanInputFormDataList).toHaveLength(1)
      expect(answer!.humanInputFormDataList![0].node_id).toBe('human-node')
      expect((answer!.humanInputFormDataList![0] as any).form_token).toBe('token-1')
    })

    it('should update existing form for same node_id', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('human-node', 'trace-human')

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node', form_token: 'token-1' },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node', form_token: 'token-2' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.humanInputFormDataList).toHaveLength(1)
      expect((answer!.humanInputFormDataList![0] as any).form_token).toBe('token-2')
    })

    it('should push new form data for different node_id', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node-1', form_token: 'token-1' },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node-2', form_token: 'token-2' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.humanInputFormDataList).toHaveLength(2)
      expect(answer!.humanInputFormDataList![0].node_id).toBe('human-node-1')
      expect(answer!.humanInputFormDataList![1].node_id).toBe('human-node-2')
    })

    it('should set tracing node status to Paused when tracing index found', () => {
      const { result } = setupAndSend()
      startWorkflow()
      startNode('human-node', 'trace-human')

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node', form_token: 'token-1' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const trace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'human-node')
      expect(trace!.status).toBe('paused')
    })
  })

  describe('onHumanInputFormFilled', () => {
    it('should remove form and add to filled list', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node', form_token: 'token-1' },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputFormFilled({
          data: { node_id: 'human-node', form_data: { answer: 'yes' } },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.humanInputFormDataList).toHaveLength(0)
      expect(answer!.humanInputFilledFormDataList).toHaveLength(1)
      expect(answer!.humanInputFilledFormDataList![0].node_id).toBe('human-node')
      expect((answer!.humanInputFilledFormDataList![0] as any).form_data).toEqual({ answer: 'yes' })
    })
  })

  describe('onHumanInputFormTimeout', () => {
    it('should update expiration_time on form data', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onHumanInputRequired({
          data: { node_id: 'human-node', form_token: 'token-1' },
        })
      })

      act(() => {
        capturedCallbacks.onHumanInputFormTimeout({
          data: { node_id: 'human-node', expiration_time: '2025-01-01T00:00:00Z' },
        })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      const form = answer!.humanInputFormDataList!.find((f: any) => f.node_id === 'human-node')
      expect(form!.expiration_time).toBe('2025-01-01T00:00:00Z')
    })
  })

  describe('onWorkflowPaused', () => {
    it('should set status to Paused', () => {
      const { result } = setupAndSend()
      startWorkflow()

      act(() => {
        capturedCallbacks.onWorkflowPaused({ data: {} })
      })

      const answer = result.current.chatList.find(item => item.isAnswer && !item.isOpeningStatement)
      expect(answer!.workflowProcess!.status).toBe('paused')
    })
  })
})
