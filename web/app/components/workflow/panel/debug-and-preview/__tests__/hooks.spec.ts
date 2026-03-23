/* eslint-disable ts/no-explicit-any */
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import { act, renderHook } from '@testing-library/react'
import { useChat } from '../hooks'

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSetIterTimes = vi.fn()
const mockSetLoopTimes = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
const mockStopChat = vi.fn()
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

vi.mock('@/app/components/base/toast/context', () => ({
  useToastContext: () => ({ notify: mockNotify }),
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
  useHooksStore: () => null,
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
  useStore: () => vi.fn(),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
  mockWorkflowRunningData = null
}

describe('workflow debug useChat – opening statement stability', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should return empty chatList when config has no opening_statement', () => {
    const { result } = renderHook(() => useChat({}))
    expect(result.current.chatList).toEqual([])
  })

  it('should return empty chatList when opening_statement is an empty string', () => {
    const { result } = renderHook(() => useChat({ opening_statement: '' }))
    expect(result.current.chatList).toEqual([])
  })

  it('should use stable id "opening-statement" instead of Date.now()', () => {
    const config = { opening_statement: 'Welcome!' }
    const { result } = renderHook(() => useChat(config))
    expect(result.current.chatList[0].id).toBe('opening-statement')
  })

  it('should preserve reference when inputs change but produce identical content', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: ['Ask {{name}}'],
    }
    const formSettings = { inputs: { name: 'Alice' }, inputsForm: [] }

    const { result, rerender } = renderHook(
      ({ fs }) => useChat(config, fs),
      { initialProps: { fs: formSettings } },
    )

    const openerBefore = result.current.chatList[0]
    expect(openerBefore.content).toBe('Hello Alice')

    rerender({ fs: { inputs: { name: 'Alice' }, inputsForm: [] } })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter).toBe(openerBefore)
  })

  it('should create new object when content actually changes', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: [],
    }

    const { result, rerender } = renderHook(
      ({ fs }) => useChat(config, fs),
      { initialProps: { fs: { inputs: { name: 'Alice' }, inputsForm: [] } } },
    )

    const openerBefore = result.current.chatList[0]
    expect(openerBefore.content).toBe('Hello Alice')

    rerender({ fs: { inputs: { name: 'Bob' }, inputsForm: [] } })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter.content).toBe('Hello Bob')
    expect(openerAfter).not.toBe(openerBefore)
  })

  it('should preserve reference for existing opening statement in prevChatTree', () => {
    const config = {
      opening_statement: 'Updated welcome',
      suggested_questions: ['S1'],
    }
    const prevChatTree = [{
      id: 'opening-statement',
      content: 'old',
      isAnswer: true,
      isOpeningStatement: true,
      suggestedQuestions: [],
    }]

    const { result, rerender } = renderHook(
      ({ cfg }) => useChat(cfg, undefined, prevChatTree as ChatItemInTree[]),
      { initialProps: { cfg: config } },
    )

    const openerBefore = result.current.chatList[0]
    expect(openerBefore.content).toBe('Updated welcome')

    rerender({ cfg: config })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter).toBe(openerBefore)
  })

  it('should include suggestedQuestions in opening statement when config has them', () => {
    const config = {
      opening_statement: 'Welcome!',
      suggested_questions: ['How are you?', 'What can you do?'],
    }
    const { result } = renderHook(() => useChat(config))
    const opener = result.current.chatList[0]
    expect(opener.suggestedQuestions).toEqual(['How are you?', 'What can you do?'])
  })

  it('should not include suggestedQuestions when config has none', () => {
    const config = { opening_statement: 'Welcome!' }
    const { result } = renderHook(() => useChat(config))
    const opener = result.current.chatList[0]
    expect(opener.suggestedQuestions).toBeUndefined()
  })
})

describe('useChat – handleStop', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should set isResponding to false', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleStop()
    })
    expect(result.current.isResponding).toBe(false)
  })

  it('should not call stopChat when taskId is empty even if stopChat is provided', () => {
    const { result } = renderHook(() => useChat({}, undefined, undefined, mockStopChat))
    act(() => {
      result.current.handleStop()
    })
    expect(mockStopChat).not.toHaveBeenCalled()
  })

  it('should reset iter/loop times to defaults', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleStop()
    })
    expect(mockSetIterTimes).toHaveBeenCalledWith(1)
    expect(mockSetLoopTimes).toHaveBeenCalledWith(1)
  })

  it('should abort workflowEventsAbortController when set', () => {
    const mockWfAbort = vi.fn()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.getAbortController({ abort: mockWfAbort } as any)
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockWfAbort).toHaveBeenCalledTimes(1)
  })

  it('should abort suggestedQuestionsAbortController when set', async () => {
    const mockSqAbort = vi.fn()
    let capturedCb: any

    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      capturedCb = callbacks
    })

    const mockGetSuggested = vi.fn().mockImplementation((_id: string, getAbortCtrl: any) => {
      getAbortCtrl({ abort: mockSqAbort } as any)
      return Promise.resolve({ data: ['s'] })
    })

    const { result } = renderHook(() =>
      useChat({ suggested_questions_after_answer: { enabled: true } }),
    )

    act(() => {
      result.current.handleSend({ query: 'test' }, {
        onGetSuggestedQuestions: mockGetSuggested,
      })
    })

    await act(async () => {
      await capturedCb.onCompleted(false)
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockSqAbort).toHaveBeenCalledTimes(1)
  })

  it('should call stopChat with taskId when both are available', () => {
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.onData('msg', true, {
        conversationId: 'c1',
        messageId: 'msg-1',
        taskId: 'task-stop',
      })
    })

    const { result } = renderHook(() => useChat({}, undefined, undefined, mockStopChat))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      result.current.handleStop()
    })

    expect(mockStopChat).toHaveBeenCalledWith('task-stop')
  })
})

describe('useChat – handleRestart', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should clear suggestedQuestions and set isResponding to false', () => {
    const config = { opening_statement: 'Hello' }
    const { result } = renderHook(() => useChat(config))

    act(() => {
      result.current.handleRestart()
    })

    expect(result.current.suggestedQuestions).toEqual([])
    expect(result.current.isResponding).toBe(false)
  })

  it('should reset iter/loop times to defaults', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleRestart()
    })
    expect(mockSetIterTimes).toHaveBeenCalledWith(1)
    expect(mockSetLoopTimes).toHaveBeenCalledWith(1)
  })
})

describe('useChat – handleSend', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
  })

  it('should call handleRun with processed params', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'hello', inputs: {} }, {})
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = mockHandleRun.mock.calls[0]
    expect(bodyParams.query).toBe('hello')
  })

  it('should show notification and return false when already responding', () => {
    mockHandleRun.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    act(() => {
      const returned = result.current.handleSend({ query: 'second' }, {})
      expect(returned).toBe(false)
    })

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('should set isResponding to true after sending', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleSend({ query: 'hello' }, {})
    })
    expect(result.current.isResponding).toBe(true)
  })

  it('should add placeholder question and answer to chatList', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test question' }, {})
    })

    const questionItem = result.current.chatList.find(item => item.content === 'test question')
    expect(questionItem).toBeDefined()
    expect(questionItem!.isAnswer).toBe(false)

    const answerPlaceholder = result.current.chatList.find(
      item => item.isAnswer && !item.isOpeningStatement && item.content === '',
    )
    expect(answerPlaceholder).toBeDefined()
  })

  it('should strip url from local_file transfer method files', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend(
        {
          query: 'hello',
          files: [
            {
              id: 'f1',
              name: 'test.png',
              size: 1024,
              type: 'image/png',
              progress: 100,
              transferMethod: 'local_file',
              supportFileType: 'image',
              url: 'blob://local',
              uploadedId: 'up1',
            },
            {
              id: 'f2',
              name: 'remote.png',
              size: 2048,
              type: 'image/png',
              progress: 100,
              transferMethod: 'remote_url',
              supportFileType: 'image',
              url: 'https://example.com/img.png',
              uploadedId: '',
            },
          ] as any,
        },
        {},
      )
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = mockHandleRun.mock.calls[0]
    const localFile = bodyParams.files.find((f: any) => f.transfer_method === 'local_file')
    const remoteFile = bodyParams.files.find((f: any) => f.transfer_method === 'remote_url')
    expect(localFile.url).toBe('')
    expect(remoteFile.url).toBe('https://example.com/img.png')
  })

  it('should abort previous workflowEventsAbortController before sending', () => {
    const mockAbort = vi.fn()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.getAbortController({ abort: mockAbort } as any)
      callbacks.onCompleted(false)
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.getAbortController({ abort: vi.fn() } as any)
    })

    act(() => {
      result.current.handleSend({ query: 'second' }, {})
    })

    expect(mockAbort).toHaveBeenCalledTimes(1)
  })
})

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
      expect(answer!.workflowProcess!.tracing[0].id).toBe('iter-r1')
      expect(answer!.workflowProcess!.tracing[0].status).toBe('running')

      act(() => {
        capturedResumeOptions.onIterationFinish({
          data: { id: 'iter-r1', node_id: 'n-iter-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0].status).toBe('succeeded')
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
      expect(answer!.workflowProcess!.tracing[0].id).toBe('loop-r1')
      expect(answer!.workflowProcess!.tracing[0].status).toBe('running')

      act(() => {
        capturedResumeOptions.onLoopFinish({
          data: { id: 'loop-r1', node_id: 'n-loop-r', execution_metadata: {} },
        })
      })

      answer = result.current.chatList.find(item => item.id === 'msg-resume')
      expect(answer!.workflowProcess!.tracing).toHaveLength(1)
      expect(answer!.workflowProcess!.tracing[0].status).toBe('succeeded')
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
      expect(matchingTraces[0].id).toBe('rtrace-1-v2')
      expect(matchingTraces[0].status).toBe('running')
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

describe('useChat – handleSwitchSibling', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockSseGet.mockReset()
  })

  it('should call handleResume when target has workflow_run_id and pending humanInputFormData', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-switch',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'msg-switch',
      })
    })

    act(() => {
      sendCallbacks.onHumanInputRequired({
        data: { node_id: 'human-n', form_token: 'ft-1' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-switch', {})
    })

    expect(mockSseGet).toHaveBeenCalled()
  })

  it('should not call handleResume when target has no humanInputFormDataList', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-switch',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'msg-switch',
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-switch', {})
    })

    expect(mockSseGet).not.toHaveBeenCalled()
  })

  it('should return undefined from findMessageInTree when not found', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSwitchSibling('nonexistent-id', {})
    })

    expect(mockSseGet).not.toHaveBeenCalled()
  })

  it('should search children recursively in findMessageInTree', async () => {
    let sendCallbacks: any
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      sendCallbacks = callbacks
    })
    mockSseGet.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'parent' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-1',
        task_id: 'task-1',
        conversation_id: null,
        message_id: 'msg-parent',
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSend({
        query: 'child',
        parent_message_id: 'msg-parent',
      }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({
        workflow_run_id: 'wfr-2',
        task_id: 'task-2',
        conversation_id: null,
        message_id: 'msg-child',
      })
    })

    act(() => {
      sendCallbacks.onHumanInputRequired({
        data: { node_id: 'h-child', form_token: 'ft-c' },
      })
    })

    await act(async () => {
      await sendCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSwitchSibling('msg-child', {})
    })

    expect(mockSseGet).toHaveBeenCalled()
  })
})

describe('useChat – handleSubmitHumanInputForm', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockSubmitHumanInputForm.mockResolvedValue({})
  })

  it('should call submitHumanInputForm with token and data', async () => {
    const { result } = renderHook(() => useChat({}))

    await act(async () => {
      await result.current.handleSubmitHumanInputForm('token-123', { field: 'value' })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-123', { field: 'value' })
  })
})

describe('useChat – getHumanInputNodeData', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockGetNodes.mockReturnValue([])
  })

  it('should return the custom node matching the given nodeID', () => {
    const mockNode = { id: 'node-1', type: 'custom', data: { title: 'Human Input' } }
    mockGetNodes.mockReturnValue([
      mockNode,
      { id: 'node-2', type: 'custom', data: { title: 'Other' } },
    ])

    const { result } = renderHook(() => useChat({}))
    const node = result.current.getHumanInputNodeData('node-1')
    expect(node).toEqual(mockNode)
  })

  it('should return undefined when no matching node', () => {
    mockGetNodes.mockReturnValue([{ id: 'node-2', type: 'custom', data: {} }])

    const { result } = renderHook(() => useChat({}))
    const node = result.current.getHumanInputNodeData('nonexistent')
    expect(node).toBeUndefined()
  })

  it('should filter out non-custom nodes', () => {
    mockGetNodes.mockReturnValue([
      { id: 'node-1', type: 'default', data: {} },
      { id: 'node-1', type: 'custom', data: { found: true } },
    ])

    const { result } = renderHook(() => useChat({}))
    const node = result.current.getHumanInputNodeData('node-1')
    expect(node).toEqual({ id: 'node-1', type: 'custom', data: { found: true } })
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
    expect(answer!.workflowProcess!.tracing[0].id).toBe('loop-bare')
    expect(answer!.workflowProcess!.tracing[0].node_id).toBe('n-loop-bare')
    expect(answer!.workflowProcess!.tracing[0].status).toBe('running')
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
    expect(answer!.workflowProcess!.tracing[0].id).toBe('iter-bare')
    expect(answer!.workflowProcess!.tracing[0].node_id).toBe('n-iter-bare')
    expect(answer!.workflowProcess!.tracing[0].status).toBe('running')
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
    expect(answer!.workflowProcess!.tracing[0].id).toBe('rtrace-bare')
    expect(answer!.workflowProcess!.tracing[0].node_id).toBe('rn-bare')
    expect(answer!.workflowProcess!.tracing[0].status).toBe('running')
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

describe('useChat – conversationId and setTargetMessageId', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
  })

  it('should initially be an empty string', () => {
    const { result } = renderHook(() => useChat({}))
    expect(result.current.conversationId).toBe('')
  })

  it('setTargetMessageId should change chatList thread path', () => {
    const prevChatTree: ChatItemInTree[] = [
      {
        id: 'q1',
        content: 'question 1',
        isAnswer: false,
        children: [
          {
            id: 'a1',
            content: 'answer 1',
            isAnswer: true,
            children: [
              {
                id: 'q2-branch-a',
                content: 'branch A question',
                isAnswer: false,
                children: [
                  { id: 'a2-branch-a', content: 'branch A answer', isAnswer: true, children: [] },
                ],
              },
              {
                id: 'q2-branch-b',
                content: 'branch B question',
                isAnswer: false,
                children: [
                  { id: 'a2-branch-b', content: 'branch B answer', isAnswer: true, children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]

    const { result } = renderHook(() => useChat({}, undefined, prevChatTree))

    const defaultList = result.current.chatList
    expect(defaultList.some(item => item.id === 'a1')).toBe(true)

    act(() => {
      result.current.setTargetMessageId('a2-branch-a')
    })

    const listA = result.current.chatList
    expect(listA.some(item => item.id === 'a2-branch-a')).toBe(true)
    expect(listA.some(item => item.id === 'a2-branch-b')).toBe(false)

    act(() => {
      result.current.setTargetMessageId('a2-branch-b')
    })

    const listB = result.current.chatList
    expect(listB.some(item => item.id === 'a2-branch-b')).toBe(true)
    expect(listB.some(item => item.id === 'a2-branch-a')).toBe(false)
  })
})

describe('useChat – updateCurrentQAOnTree with parent_message_id', () => {
  let capturedCallbacks: any

  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      capturedCallbacks = callbacks
    })
  })

  it('should handle follow-up message with parent_message_id', async () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    const firstCallbacks = capturedCallbacks

    act(() => {
      firstCallbacks.onData('answer1', true, {
        conversationId: 'c1',
        messageId: 'msg-1',
        taskId: 't1',
      })
    })

    await act(async () => {
      await firstCallbacks.onCompleted(false)
    })

    act(() => {
      result.current.handleSend({
        query: 'follow up',
        parent_message_id: 'msg-1',
      }, {})
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(2)
    expect(result.current.chatList.length).toBeGreaterThan(0)
  })
})
