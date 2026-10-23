// oxlint-disable-next-line no-restricted-imports -- The SSE boundary fixture uses the transport callback contract; it does not issue HTTP requests.
import type { IOtherOptions } from '@/service/base'
import { act } from '@testing-library/react'
import {
  baseRunningData,
  renderWorkflowFlowHook as renderHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useChat } from '../../hooks'

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: unknown[]) => mockNotify(...args),
  },
}))

vi.mock('../../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
}))

vi.mock('../../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

// Protocol fixtures supply the fields relevant to each stream transition.
type EventFixture<T> = T extends object ? { [K in keyof T]?: EventFixture<T[K]> } : T
type SSECallbacks = {
  [K in keyof IOtherOptions]-?: NonNullable<IOtherOptions[K]> extends (...args: infer A) => infer R
    ? (...args: { [I in keyof A]: EventFixture<A[I]> }) => R
    : never
}

describe('useChat – handleResume', () => {
  let capturedResumeOptions: SSECallbacks

  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
  })

  async function setupResumeWithTree() {
    let sendCallbacks: SSECallbacks
    mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
      sendCallbacks = callbacks as SSECallbacks
    })
    mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
      capturedResumeOptions = options as SSECallbacks
    })

    const hook = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      hook.result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: undefined,
        message_id: 'msg-resume',
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      hook.result.current.handleResume('msg-resume', 'wfr-1', {})
    })

    return hook
  }

  it('should call sseGet with the correct URL', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/wfr-1/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.any(Object),
    )
  })

  it('should abort previous SSE connection when handleResume is called again', () => {
    const mockAbortCtrl = new AbortController()
    mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
      options.getAbortController!(mockAbortCtrl)
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
      options.getAbortController!(new AbortController())
    })

    act(() => {
      result.current.handleResume('msg-1', 'wfr-2', {})
    })

    expect(mockAbortCtrl.signal.aborted).toBe(true)
  })

  it('should abort previous workflowEventsAbortController before sseGet', () => {
    const abortController = new AbortController()
    let sendCallbacks: SSECallbacks
    mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
      sendCallbacks = callbacks as SSECallbacks
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.getAbortController(abortController)
    })

    mockSseGet.mockImplementation(() => {})

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    expect(abortController.signal.aborted).toBe(true)
  })

  describe('onWorkflowStarted', () => {
    it('should resume existing workflow when tracing exists', async () => {
      let sendCallbacks: SSECallbacks
      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        sendCallbacks = callbacks as SSECallbacks
      })
      mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
        capturedResumeOptions = options as SSECallbacks
      })

      const hook = renderHook(() => useChat({}), {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      })

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: undefined,
          message_id: 'msg-resume',
        })
      })

      act(() => {
        sendCallbacks.onNodeStarted({
          data: { node_id: 'n1', id: 'trace-1' },
        })
      })

      await act(async () => {
        await sendCallbacks.onCompleted(false)
      })

      act(() => {
        hook.result.current.handleResume('msg-resume', 'wfr-1', {})
      })

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      const answer = hook.result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(hook.result.current.isResponding).toBe(true)
      expect(answer!.workflowProcess).toMatchObject({
        status: 'running',
        tracing: [expect.objectContaining({ id: 'trace-1', node_id: 'n1' })],
      })
    })
  })

  describe('onWorkflowFinished', () => {
    it('should update workflow status', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onWorkflowFinished({
          data: { status: 'succeeded' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('succeeded')
    })

    it('should store workflow finished error on resume workflow process', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onWorkflowFinished({
          data: { status: 'failed', error: 'Invalid upload file' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('failed')
      expect(answer!.workflowProcess!.error).toBe('Invalid upload file')
    })
  })

  describe('onData', () => {
    it('should append message content', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onData('resumed', false, {
          conversationId: 'conv-2',
          messageId: 'msg-resume',
          taskId: 'task-2',
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.content).toContain('resumed')
    })

    it('should update conversationId when provided', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onData('msg', false, {
          conversationId: 'new-conv-resume',
          messageId: undefined,
          taskId: 'task-2',
        })
      })

      expect(result.current.conversationId).toBe('new-conv-resume')
    })
  })

  describe('onReasoning', () => {
    it('should accumulate reasoning per node onto the resumed answer', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onReasoning({
          data: { message_id: 'msg-resume', reasoning: 'resumed ', node_id: 'llm' },
        })
        capturedResumeOptions.onReasoning({
          data: { message_id: 'msg-resume', reasoning: 'thought', node_id: 'llm', is_final: true },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.reasoningContent).toEqual({ llm: 'resumed thought' })
      expect(answer!.reasoningFinished).toBe(true)
    })

    it('should ignore empty reasoning and fall back to "_" when node_id is absent', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onReasoning({ data: { message_id: 'msg-resume', reasoning: '' } })
        capturedResumeOptions.onReasoning({ data: { message_id: 'msg-resume', reasoning: 'a' } })
        capturedResumeOptions.onReasoning({ data: { message_id: 'msg-resume', reasoning: 'b' } })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.reasoningContent).toEqual({ _: 'ab' })
      expect(answer!.reasoningFinished).toBeUndefined()
    })
  })

  describe('onCompleted', () => {
    it('should set isResponding to false', async () => {
      const { result } = await setupResumeWithTree()
      act(() =>
        capturedResumeOptions.onWorkflowStarted({ workflow_run_id: 'wfr-1', task_id: 'task-1' }),
      )
      expect(result.current.isResponding).toBe(true)
      mockFetchInspectVars.mockClear()
      mockInvalidAllLastRun.mockClear()
      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })
      expect(result.current.isResponding).toBe(false)
      expect(mockFetchInspectVars).toHaveBeenCalledExactlyOnceWith({})
      expect(mockInvalidAllLastRun).toHaveBeenCalledTimes(1)
    })

    it('should not call fetchInspectVars when paused', async () => {
      const { store } = await setupResumeWithTree()
      store.setState({
        workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Paused } }),
      })
      mockFetchInspectVars.mockClear()
      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })
      expect(mockFetchInspectVars).not.toHaveBeenCalled()
    })

    it('should still call fetchInspectVars on error but skip suggested questions', async () => {
      const mockGetSuggested = vi.fn().mockResolvedValue({ data: ['s1'] })
      let sendCallbacks: SSECallbacks
      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        sendCallbacks = callbacks as SSECallbacks
      })
      mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
        capturedResumeOptions = options as SSECallbacks
      })

      const hook = renderHook(
        () => useChat({ suggested_questions_after_answer: { enabled: true } }),
        { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
      )

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })
      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: undefined,
          message_id: 'msg-resume',
        })
      })
      await act(async () => {
        await sendCallbacks.onCompleted(false)
      })
      mockFetchInspectVars.mockClear()
      mockInvalidAllLastRun.mockClear()

      act(() => {
        hook.result.current.handleResume('msg-resume', 'wfr-1', {
          onGetSuggestedQuestions: mockGetSuggested,
        })
      })
      await act(async () => {
        await capturedResumeOptions.onCompleted(true)
      })

      expect(mockFetchInspectVars).toHaveBeenCalledWith({})
      expect(mockInvalidAllLastRun).toHaveBeenCalled()
      expect(mockGetSuggested).not.toHaveBeenCalled()
    })

    it('should fetch suggested questions when enabled', async () => {
      const mockGetSuggested = vi
        .fn()
        .mockImplementation((_id: string, onCancel: (cancel: () => void) => void) => {
          onCancel(vi.fn())
          return Promise.resolve({ data: ['s1'] })
        })
      let sendCallbacks: SSECallbacks
      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        sendCallbacks = callbacks as SSECallbacks
      })
      mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
        capturedResumeOptions = options as SSECallbacks
      })

      const hook = renderHook(
        () => useChat({ suggested_questions_after_answer: { enabled: true } }),
        { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
      )

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: undefined,
          message_id: 'msg-resume',
        })
      })

      await act(async () => {
        await sendCallbacks.onCompleted(false)
      })

      act(() => {
        hook.result.current.handleResume('msg-resume', 'wfr-1', {
          onGetSuggestedQuestions: mockGetSuggested,
        })
      })

      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })

      expect(mockGetSuggested).toHaveBeenCalledWith('msg-resume', expect.any(Function))
      expect(hook.result.current.suggestedQuestions).toEqual(['s1'])
    })

    it('should set suggestedQuestions to empty on fetch error', async () => {
      const mockGetSuggested = vi.fn().mockRejectedValue(new Error('fail'))
      let sendCallbacks: SSECallbacks
      mockHandleRun.mockImplementation((_params: unknown, callbacks: unknown) => {
        sendCallbacks = callbacks as SSECallbacks
      })
      mockSseGet.mockImplementation((_url: unknown, _opts: unknown, options: IOtherOptions) => {
        capturedResumeOptions = options as SSECallbacks
      })

      const hook = renderHook(
        () => useChat({ suggested_questions_after_answer: { enabled: true } }),
        { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
      )

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: undefined,
          message_id: 'msg-resume',
        })
      })

      await act(async () => {
        await sendCallbacks.onCompleted(false)
      })

      act(() => {
        hook.result.current.handleResume('msg-resume', 'wfr-1', {
          onGetSuggestedQuestions: mockGetSuggested,
        })
      })

      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })

      expect(hook.result.current.suggestedQuestions).toEqual([])
    })
  })

  describe('onError', () => {
    it('should set isResponding to false', async () => {
      const { result } = await setupResumeWithTree()
      act(() => {
        capturedResumeOptions.onError('Stream failed')
      })
      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('onMessageEnd', () => {
    it('should update citation and files', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onMessageEnd({
          metadata: { retriever_resources: [{ document_id: 'cite-1' }] },
          files: [],
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.citation).toEqual([{ document_id: 'cite-1' }])
    })
  })

  describe('onMessageReplace', () => {
    it('should replace content', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onMessageReplace({ answer: 'replaced' })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.content).toBe('replaced')
    })
  })

  describe('onIterationStart / onIterationFinish', () => {
    it('should push and update iteration tracing entries', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onIterationStart({
          data: { id: 'iter-r1', node_id: 'n-iter-r' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.id).toBe('iter-r1')
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onIterationFinish({
          data: { id: 'iter-r1', node_id: 'n-iter-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('succeeded')
    })
  })

  describe('onLoopStart / onLoopFinish', () => {
    it('should push and update loop tracing entries', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onLoopStart({
          data: { id: 'loop-r1', node_id: 'n-loop-r' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.id).toBe('loop-r1')
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onLoopFinish({
          data: { id: 'loop-r1', node_id: 'n-loop-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('succeeded')
    })
  })

  describe('onNodeStarted / onNodeFinished', () => {
    it('should add and update node tracing entries', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const startedTrace = answer!.workflowProcess!.tracing.find((t) => t.node_id === 'rn-1')
      expect(startedTrace).toBeDefined()
      expect(startedTrace!.id).toBe('rtrace-1')
      expect(startedTrace!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onNodeFinished({
          data: { node_id: 'rn-1', id: 'rtrace-1', status: 'succeeded' },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const finishedTrace = answer!.workflowProcess!.tracing.find((t) => t.node_id === 'rn-1')
      expect(finishedTrace).toBeDefined()
      expect(finishedTrace!.status).toBe('succeeded')
    })

    it('should skip onNodeStarted when iteration_id is present', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-child', id: 'rtrace-child', iteration_id: 'iter-parent' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing.some((t) => t.node_id === 'rn-child')).toBe(false)
    })

    it('should update existing node in tracing on onNodeStarted', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1-v2' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const matchingTraces = answer!.workflowProcess!.tracing.filter((t) => t.node_id === 'rn-1')
      expect(matchingTraces).toHaveLength(1)
      expect(matchingTraces[0]!.id).toBe('rtrace-1-v2')
      expect(matchingTraces[0]!.status).toBe('running')
    })

    it('should match nodeFinished with parallel_id', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-1', id: 'rtrace-1', execution_metadata: { parallel_id: 'p1' } },
        })
      })

      act(() => {
        capturedResumeOptions.onNodeFinished({
          data: {
            node_id: 'rn-1',
            id: 'rtrace-1',
            status: 'succeeded',
            execution_metadata: { parallel_id: 'p1' },
          },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const trace = answer!.workflowProcess!.tracing.find((t) => t.id === 'rtrace-1')
      expect(trace).toBeDefined()
      expect(trace!.status).toBe('succeeded')
      expect(trace!.execution_metadata!.parallel_id).toBe('p1')
    })
  })

  describe('onHumanInputRequired', () => {
    it('should update existing form for same node and push for different node', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-2' },
        })
      })

      let answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(1)

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human-2', node_id: 'rn-human-2', form_token: 'rt-3' },
        })
      })

      answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toEqual([
        { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-2' },
        { form_id: 'form-rn-human-2', node_id: 'rn-human-2', form_token: 'rt-3' },
      ])
    })

    it('should set tracing node to Paused when tracing match is found', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeStarted({
          data: { node_id: 'rn-human', id: 'trace-human' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const trace = answer!.workflowProcess!.tracing.find((t) => t.node_id === 'rn-human')
      expect(trace!.status).toBe('paused')
    })
  })

  describe('onHumanInputFormFilled', () => {
    it('should move form from pending to filled list', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputFormFilled({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', submitted_data: { a: 'one' } },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(0)
      expect(answer!.humanInputFilledFormDataList).toEqual([
        expect.objectContaining({ node_id: 'rn-human', submitted_data: { a: 'one' } }),
      ])
    })
  })

  describe('onHumanInputFormTimeout', () => {
    it('ignores a late timeout for a submitted form while another form is pending', async () => {
      const { result } = await setupResumeWithTree()
      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-submitted', node_id: 'submitted', form_token: 'one' },
        })
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-pending', node_id: 'pending', form_token: 'two' },
        })
        capturedResumeOptions.onHumanInputFormFilled({
          data: {
            form_id: 'form-submitted',
            node_id: 'submitted',
            submitted_data: { answer: 'yes' },
          },
        })
        capturedResumeOptions.onHumanInputFormTimeout({
          data: { form_id: 'form-submitted', node_id: 'submitted', expiration_time: 1748736000 },
        })
      })
      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toEqual([
        { form_id: 'form-pending', node_id: 'pending', form_token: 'two' },
      ])
      expect(answer!.humanInputFilledFormDataList).toEqual([
        expect.objectContaining({ node_id: 'submitted', submitted_data: { answer: 'yes' } }),
      ])
    })

    it('should set expiration_time on the form entry', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputFormTimeout({
          data: { form_id: 'form-rn-human', node_id: 'rn-human', expiration_time: 1748736000 },
        })
      })

      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      const form = answer!.humanInputFormDataList!.find((f) => f.node_id === 'rn-human')
      expect(form!.expiration_time).toBe(1748736000)
    })
  })

  describe('onWorkflowPaused', () => {
    it('should keep the resumable stream and set status to Paused', async () => {
      const { result } = await setupResumeWithTree()
      const sseGetCallsBefore = mockSseGet.mock.calls.length

      act(() => {
        capturedResumeOptions.onWorkflowPaused({
          data: { workflow_run_id: 'wfr-paused' },
        })
      })

      expect(mockSseGet.mock.calls.length).toBe(sseGetCallsBefore)
      const answer = result.current.chatList.find((item) => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('paused')
    })
  })
})
