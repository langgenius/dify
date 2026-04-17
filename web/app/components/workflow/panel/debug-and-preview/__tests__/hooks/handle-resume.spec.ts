/* eslint-disable ts/no-explicit-any */
import type { ChatItemInTree } from '@/app/components/base/chat/types'
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

describe('useChat – handleResume', () => {
  let capturedResumeOptions: any

  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
  })

  async function setupResumeWithTree() {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
      capturedResumeOptions = options
    })

    const hook = renderHook(() => useChat({}))

    act(() => {
      hook.result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: null,
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
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    expect(mockSseGet).toHaveBeenCalledWith(
      '/workflow/wfr-1/events?include_state_snapshot=true',
      {},
      expect.any(Object),
    )
  })

  it('should abort previous SSE connection when handleResume is called again', () => {
    const mockAbortCtrl = new AbortController()
    mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
      options.getAbortController(mockAbortCtrl)
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    const mockAbort2 = vi.fn()
    mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
      options.getAbortController({ abort: mockAbort2 })
    })

    act(() => {
      result.current.handleResume('msg-1', 'wfr-2', {})
    })

    expect(mockAbortCtrl.signal.aborted).toBe(true)
  })

  it('should abort previous workflowEventsAbortController before sseGet', () => {
    const mockAbort = vi.fn()
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.getAbortController({ abort: mockAbort } as any)
    })

    mockSseGet.mockImplementation(() => {})

    act(() => {
      result.current.handleResume('msg-1', 'wfr-1', {})
    })

    expect(mockAbort).toHaveBeenCalledTimes(1)
  })

  describe('onWorkflowStarted', () => {
    it('should set isResponding and update workflow process', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      expect(result.current.isResponding).toBe(true)
    })

    it('should resume existing workflow when tracing exists', async () => {
      let sendCallbacks: any
      mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
        sendCallbacks = callbacks
      })
      mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
        capturedResumeOptions = options
      })

      const hook = renderHook(() => useChat({}))

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: null,
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

      const answer = hook.result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('running')
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

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('succeeded')
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

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.content).toContain('resumed')
    })

    it('should update conversationId when provided', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onData('msg', false, {
          conversationId: 'new-conv-resume',
          messageId: null,
          taskId: 'task-2',
        })
      })

      expect(result.current.conversationId).toBe('new-conv-resume')
    })
  })

  describe('onCompleted', () => {
    it('should set isResponding to false', async () => {
      const { result } = await setupResumeWithTree()
      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })
      expect(result.current.isResponding).toBe(false)
    })

    it('should not call fetchInspectVars when paused', async () => {
      mockWorkflowRunningData = { result: { status: 'paused' } }
      await setupResumeWithTree()
      mockFetchInspectVars.mockClear()
      await act(async () => {
        await capturedResumeOptions.onCompleted(false)
      })
      expect(mockFetchInspectVars).not.toHaveBeenCalled()
    })

    it('should still call fetchInspectVars on error but skip suggested questions', async () => {
      const mockGetSuggested = vi.fn().mockResolvedValue({ data: ['s1'] })
      let sendCallbacks: any
      mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
        sendCallbacks = callbacks
      })
      mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
        capturedResumeOptions = options
      })

      const hook = renderHook(() =>
        useChat({ suggested_questions_after_answer: { enabled: true } }),
      )

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })
      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: null,
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
      const mockGetSuggested = vi.fn().mockImplementation((_id: string, getAbortCtrl: any) => {
        getAbortCtrl(new AbortController())
        return Promise.resolve({ data: ['s1'] })
      })
      let sendCallbacks: any
      mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
        sendCallbacks = callbacks
      })
      mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
        capturedResumeOptions = options
      })

      const hook = renderHook(() =>
        useChat({ suggested_questions_after_answer: { enabled: true } }),
      )

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: null,
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

      expect(mockGetSuggested).toHaveBeenCalled()
    })

    it('should set suggestedQuestions to empty on fetch error', async () => {
      const mockGetSuggested = vi.fn().mockRejectedValue(new Error('fail'))
      let sendCallbacks: any
      mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
        sendCallbacks = callbacks
      })
      mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
        capturedResumeOptions = options
      })

      const hook = renderHook(() =>
        useChat({ suggested_questions_after_answer: { enabled: true } }),
      )

      act(() => {
        hook.result.current.handleSend({ query: 'test' }, {})
      })

      act(() => {
        sendCallbacks.onWorkflowStarted({
          workflow_run_id: 'wfr-1',
          task_id: 'task-1',
          conversation_id: null,
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
        capturedResumeOptions.onError()
      })
      expect(result.current.isResponding).toBe(false)
    })
  })

  describe('onMessageEnd', () => {
    it('should update citation and files', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onMessageEnd({
          metadata: { retriever_resources: [{ id: 'cite-1' }] },
          files: [],
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.citation).toEqual([{ id: 'cite-1' }])
    })
  })

  describe('onMessageReplace', () => {
    it('should replace content', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onMessageReplace({ answer: 'replaced' })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
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

      let answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.id).toBe('iter-r1')
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onIterationFinish({
          data: { id: 'iter-r1', node_id: 'n-iter-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('succeeded')
    })

    it('should handle iteration finish when no match found', async () => {
      await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onIterationFinish({
          data: { id: 'no-match', node_id: 'no-match', execution_metadata: {} },
        })
      })
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

      let answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.id).toBe('loop-r1')
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onLoopFinish({
          data: { id: 'loop-r1', node_id: 'n-loop-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0]!.status).toBe('succeeded')
    })

    it('should handle loop finish when no match found', async () => {
      await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onLoopFinish({
          data: { id: 'no-match', node_id: 'no-match', execution_metadata: {} },
        })
      })
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

      let answer = result.current.chatList.find(item => item.id === 'msg-resume')
      const startedTrace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'rn-1')
      expect(startedTrace).toBeDefined()
      expect(startedTrace!.id).toBe('rtrace-1')
      expect(startedTrace!.status).toBe('running')

      act(() => {
        capturedResumeOptions.onNodeFinished({
          data: { node_id: 'rn-1', id: 'rtrace-1', status: 'succeeded' },
        })
      })

      answer = result.current.chatList.find(item => item.id === 'msg-resume')
      const finishedTrace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'rn-1')
      expect(finishedTrace).toBeDefined()
      expect((finishedTrace as any).status).toBe('succeeded')
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

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing.some((t: any) => t.node_id === 'rn-child')).toBe(false)
    })

    it('should skip onNodeFinished when iteration_id is present', async () => {
      await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onWorkflowStarted({
          workflow_run_id: 'wfr-2',
          task_id: 'task-2',
        })
      })

      act(() => {
        capturedResumeOptions.onNodeFinished({
          data: { node_id: 'rn-1', id: 'rtrace-1', iteration_id: 'iter-parent' },
        })
      })
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

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      const matchingTraces = answer!.workflowProcess!.tracing.filter((t: any) => t.node_id === 'rn-1')
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

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      const trace = answer!.workflowProcess!.tracing.find((t: any) => t.id === 'rtrace-1')
      expect(trace).toBeDefined()
      expect((trace as any).status).toBe('succeeded')
      expect((trace as any).execution_metadata.parallel_id).toBe('p1')
    })
  })

  describe('onHumanInputRequired', () => {
    it('should initialize humanInputFormDataList', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(1)
    })

    it('should update existing form for same node and push for different node', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { node_id: 'rn-human', form_token: 'rt-2' },
        })
      })

      let answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(1)

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { node_id: 'rn-human-2', form_token: 'rt-3' },
        })
      })

      answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(2)
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
          data: { node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      const trace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'rn-human')
      expect(trace!.status).toBe('paused')
    })
  })

  describe('onHumanInputFormFilled', () => {
    it('should move form from pending to filled list', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputFormFilled({
          data: { node_id: 'rn-human', form_data: { a: 1 } },
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.humanInputFormDataList).toHaveLength(0)
      expect(answer!.humanInputFilledFormDataList).toHaveLength(1)
    })

    it('should initialize humanInputFilledFormDataList when not present', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputFormFilled({
          data: { node_id: 'rn-human', form_data: { b: 2 } },
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.humanInputFilledFormDataList).toHaveLength(1)
    })
  })

  describe('onHumanInputFormTimeout', () => {
    it('should set expiration_time on the form entry', async () => {
      const { result } = await setupResumeWithTree()

      act(() => {
        capturedResumeOptions.onHumanInputRequired({
          data: { node_id: 'rn-human', form_token: 'rt-1' },
        })
      })

      act(() => {
        capturedResumeOptions.onHumanInputFormTimeout({
          data: { node_id: 'rn-human', expiration_time: '2025-06-01' },
        })
      })

      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      const form = answer!.humanInputFormDataList!.find((f: any) => f.node_id === 'rn-human')
      expect(form!.expiration_time).toBe('2025-06-01')
    })
  })

  describe('onWorkflowPaused', () => {
    it('should re-subscribe via sseGet and set status to Paused', async () => {
      const { result } = await setupResumeWithTree()
      const sseGetCallsBefore = mockSseGet.mock.calls.length

      act(() => {
        capturedResumeOptions.onWorkflowPaused({
          data: { workflow_run_id: 'wfr-paused' },
        })
      })

      expect(mockSseGet.mock.calls.length).toBeGreaterThan(sseGetCallsBefore)
      const answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.status).toBe('paused')
    })
  })
})

describe('useChat – handleResume with bare prevChatTree (no humanInputFormDataList / no tracing)', () => {
  let capturedResumeOptions: any

  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
    mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
      capturedResumeOptions = options
    })
  })

  function setupWithBareTree() {
    const prevChatTree: ChatItemInTree[] = [
      {
        id: 'q1',
        content: 'question',
        isAnswer: false,
        children: [
          {
            id: 'bare-msg',
            content: '',
            isAnswer: true,
            workflow_run_id: 'wfr-bare',
            workflowProcess: {
              status: 'running' as any,
              tracing: [],
            },
            children: [],
          },
        ],
      },
    ]

    const hook = renderHook(() => useChat({}, undefined, prevChatTree))

    act(() => {
      hook.result.current.handleResume('bare-msg', 'wfr-bare', {})
    })

    return hook
  }

  function setupWithBareTreeNoTracing() {
    const prevChatTree: ChatItemInTree[] = [
      {
        id: 'q1',
        content: 'question',
        isAnswer: false,
        children: [
          {
            id: 'bare-msg-nt',
            content: '',
            isAnswer: true,
            workflow_run_id: 'wfr-bare-nt',
            workflowProcess: {
              status: 'running' as any,
              tracing: undefined as any,
            },
            children: [],
          },
        ],
      },
    ]

    const hook = renderHook(() => useChat({}, undefined, prevChatTree))

    act(() => {
      hook.result.current.handleResume('bare-msg-nt', 'wfr-bare-nt', {})
    })

    return hook
  }

  it('onHumanInputRequired should initialize humanInputFormDataList when null', () => {
    const { result } = setupWithBareTree()

    act(() => {
      capturedResumeOptions.onHumanInputRequired({
        data: { node_id: 'hn-bare', form_token: 'ft-bare' },
      })
    })

    const answer = result.current.chatList.find(item => item.id === 'bare-msg')
    expect(answer!.humanInputFormDataList).toHaveLength(1)
  })

  it('onHumanInputFormFilled should initialize humanInputFilledFormDataList when null', () => {
    const { result } = setupWithBareTree()

    act(() => {
      capturedResumeOptions.onHumanInputFormFilled({
        data: { node_id: 'hn-bare', form_data: { x: 1 } },
      })
    })

    const answer = result.current.chatList.find(item => item.id === 'bare-msg')
    expect(answer!.humanInputFilledFormDataList).toHaveLength(1)
  })

  it('onLoopStart should initialize tracing array when not present', () => {
    const { result } = setupWithBareTreeNoTracing()

    act(() => {
      capturedResumeOptions.onLoopStart({
        data: { id: 'loop-bare', node_id: 'n-loop-bare' },
      })
    })

    const answer = result.current.chatList.find(item => item.id === 'bare-msg-nt')
    expect(answer!.workflowProcess!.tracing).toHaveLength(1)
    expect(answer!.workflowProcess!.tracing[0]!.id).toBe('loop-bare')
    expect(answer!.workflowProcess!.tracing[0]!.node_id).toBe('n-loop-bare')
    expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')
  })

  it('onLoopFinish should return early when no tracing', () => {
    setupWithBareTreeNoTracing()

    act(() => {
      capturedResumeOptions.onLoopFinish({
        data: { id: 'loop-bare', node_id: 'n-loop-bare', execution_metadata: {} },
      })
    })
  })

  it('onIterationStart should initialize tracing when not present', () => {
    const { result } = setupWithBareTreeNoTracing()

    act(() => {
      capturedResumeOptions.onIterationStart({
        data: { id: 'iter-bare', node_id: 'n-iter-bare' },
      })
    })

    const answer = result.current.chatList.find(item => item.id === 'bare-msg-nt')
    expect(answer!.workflowProcess!.tracing).toHaveLength(1)
    expect(answer!.workflowProcess!.tracing[0]!.id).toBe('iter-bare')
    expect(answer!.workflowProcess!.tracing[0]!.node_id).toBe('n-iter-bare')
    expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')
  })

  it('onIterationFinish should return early when no tracing', () => {
    setupWithBareTreeNoTracing()

    act(() => {
      capturedResumeOptions.onIterationFinish({
        data: { id: 'iter-bare', node_id: 'n-iter-bare', execution_metadata: {} },
      })
    })
  })

  it('onNodeStarted should initialize tracing when not present', () => {
    const { result } = setupWithBareTreeNoTracing()

    act(() => {
      capturedResumeOptions.onNodeStarted({
        data: { node_id: 'rn-bare', id: 'rtrace-bare' },
      })
    })

    const answer = result.current.chatList.find(item => item.id === 'bare-msg-nt')
    expect(answer!.workflowProcess!.tracing).toHaveLength(1)
    expect(answer!.workflowProcess!.tracing[0]!.id).toBe('rtrace-bare')
    expect(answer!.workflowProcess!.tracing[0]!.node_id).toBe('rn-bare')
    expect(answer!.workflowProcess!.tracing[0]!.status).toBe('running')
  })

  it('onNodeFinished should return early when no tracing', () => {
    setupWithBareTreeNoTracing()

    act(() => {
      capturedResumeOptions.onNodeFinished({
        data: { node_id: 'rn-bare', id: 'rtrace-bare', status: 'succeeded' },
      })
    })
  })

  it('onIterationStart/onNodeStarted/onLoopStart should return early when no workflowProcess', () => {
    const prevChatTreeNoWP: ChatItemInTree[] = [
      {
        id: 'q-nowp',
        content: 'question',
        isAnswer: false,
        children: [
          {
            id: 'bare-nowp',
            content: '',
            isAnswer: true,
            children: [],
          },
        ],
      },
    ]

    const hook = renderHook(() => useChat({}, undefined, prevChatTreeNoWP))
    let opts: any
    mockSseGet.mockImplementation((_url: any, _opts: any, options: any) => {
      opts = options
    })

    act(() => {
      hook.result.current.handleResume('bare-nowp', 'wfr-x', {})
    })

    act(() => {
      opts.onIterationStart({ data: { id: 'i1', node_id: 'ni1' } })
    })

    act(() => {
      opts.onNodeStarted({ data: { node_id: 'ns1', id: 'ts1' } })
    })

    act(() => {
      opts.onLoopStart({ data: { id: 'l1', node_id: 'nl1' } })
    })

    const answer = hook.result.current.chatList.find(item => item.id === 'bare-nowp')
    expect(answer!.workflowProcess).toBeUndefined()
  })

  it('onHumanInputRequired should set Paused on tracing node when found', () => {
    const { result } = setupWithBareTree()

    act(() => {
      capturedResumeOptions.onWorkflowStarted({
        workflow_run_id: 'wfr-2',
        task_id: 'task-2',
      })
    })

    act(() => {
      capturedResumeOptions.onNodeStarted({
        data: { node_id: 'hn-with-trace', id: 'trace-hn' },
      })
    })

    act(() => {
      capturedResumeOptions.onHumanInputRequired({
        data: { node_id: 'hn-with-trace', form_token: 'ft-tr' },
      })
    })

    const answer = result.current.chatList.find(item => item.id === 'bare-msg')
    const trace = answer!.workflowProcess!.tracing.find((t: any) => t.node_id === 'hn-with-trace')
    expect(trace!.status).toBe('paused')
  })
})
