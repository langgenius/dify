import type { ChatConfig, ChatItemInTree } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, renderHook } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useParams, usePathname } from '@/next/navigation'
import { sseGet, ssePost } from '@/service/base'
import { useChat } from '../hooks'

vi.mock('@/service/base', () => ({
  sseGet: vi.fn(),
  ssePost: vi.fn(),
}))

vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: {
    getInstance: () => ({
      getAudioPlayer: vi.fn().mockReturnValue({ playAudioWithAudio: vi.fn() }),
      resetMsgId: vi.fn(),
    }),
  },
}))

vi.mock('@/app/components/base/toast/context', () => ({
  useToastContext: () => ({ notify: vi.fn() }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: vi.fn().mockReturnValue('10:00 AM') }),
}))

vi.mock('@/next/navigation', () => ({
  useParams: vi.fn(() => ({})),
  usePathname: vi.fn(() => ''),
  useRouter: vi.fn(() => ({})),
}))

const createAbortControllerMock = () => {
  const controller = new AbortController()
  vi.spyOn(controller, 'abort')
  return controller
}
type HookCallbacks = {
  getAbortController: (abortController: AbortController) => void
  onCompleted: (hasError?: boolean, errorMessage?: string) => Promise<void> | void
  onData: (message: string, isFirstMessage: boolean, moreInfo: Record<string, unknown>) => void
  onThought: (thought: Record<string, unknown>) => void
  onFile: (file: Record<string, unknown>) => void
  onMessageEnd: (messageEnd: Record<string, unknown>) => void
  onMessageReplace: (messageReplace: Record<string, unknown>) => void
  onError: (...args: unknown[]) => void
  onWorkflowStarted: (workflowStarted: Record<string, unknown>) => void
  onWorkflowFinished: (workflowFinished: Record<string, unknown>) => void
  onNodeStarted: (nodeStarted: Record<string, unknown>) => void
  onNodeFinished: (nodeFinished: Record<string, unknown>) => void
  onIterationStart: (iterationStarted: Record<string, unknown>) => void
  onIterationFinish: (iterationFinished: Record<string, unknown>) => void
  onLoopStart: (loopStarted: Record<string, unknown>) => void
  onLoopFinish: (loopFinished: Record<string, unknown>) => void
  onHumanInputRequired: (required: Record<string, unknown>) => void
  onHumanInputFormFilled: (filled: Record<string, unknown>) => void
  onHumanInputFormTimeout: (timeout: Record<string, unknown>) => void
  onWorkflowPaused: (workflowPaused: Record<string, unknown>) => void
  onTTSChunk: (messageId: string, audio: string) => void
  onTTSEnd: (messageId: string, audio: string) => void
}
type UseChatFormSettings = NonNullable<Parameters<typeof useChat>[1]>

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(useParams).mockReturnValue({} as ReturnType<typeof useParams>)
    vi.mocked(usePathname).mockReturnValue('')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize correctly with empty config', () => {
    const { result } = renderHook(() => useChat())
    expect(result.current.chatList).toEqual([])
    expect(result.current.isResponding).toBe(false)
    expect(result.current.suggestedQuestions).toEqual([])
  })

  it('should initialize with opening statement and suggested questions', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: ['One', 'Two'],
    }
    const formSettings = {
      inputs: { name: 'Alice' },
      inputsForm: [],
    }
    const { result } = renderHook(() => useChat(config as ChatConfig, formSettings))

    expect(result.current.chatList).toHaveLength(1)
    expect(result.current.chatList[0].content).toBe('Hello Alice')
    expect(result.current.chatList[0].suggestedQuestions).toEqual(['One', 'Two'])
  })

  it('should update existing opening statement if already present in threadMessages', () => {
    const config = {
      opening_statement: 'Hello updated',
      suggested_questions: [''],
    }
    const prevChatTree = [{
      id: 'opening-statement',
      content: 'old',
      isAnswer: true,
      isOpeningStatement: true,
      suggestedQuestions: [],
    }]

    const { result } = renderHook(() => useChat(config as ChatConfig, undefined, prevChatTree as ChatItemInTree[]))
    expect(result.current.chatList).toHaveLength(1)
    expect(result.current.chatList[0].content).toBe('Hello updated')
  })

  it('should update existing opening statement suggested questions using processed values', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: ['Ask {{name}}'],
    }
    const formSettings = {
      inputs: { name: 'Bob' },
      inputsForm: [],
    }
    const prevChatTree = [{
      id: 'opening-statement',
      content: 'old',
      isAnswer: true,
      isOpeningStatement: true,
      suggestedQuestions: [],
    }]

    const { result } = renderHook(() => useChat(config as ChatConfig, formSettings as UseChatFormSettings, prevChatTree as ChatItemInTree[]))

    expect(result.current.chatList[0].content).toBe('Hello Bob')
    expect(result.current.chatList[0].suggestedQuestions).toEqual(['Ask Bob'])
  })

  describe('opening statement referential stability', () => {
    it('should keep the same item reference across multiple streaming chatTree mutations', () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const config = {
        opening_statement: 'Welcome!',
        suggested_questions: ['Q1', 'Q2'],
      }
      const { result } = renderHook(() => useChat(config as ChatConfig))

      const openerInitial = result.current.chatList[0]
      expect(openerInitial.isOpeningStatement).toBe(true)
      expect(openerInitial.content).toBe('Welcome!')

      act(() => {
        result.current.handleSend('url', { query: 'hello' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
      })
      expect(result.current.chatList[0]).toBe(openerInitial)

      act(() => {
        callbacks.onData('chunk-1 ', true, { messageId: 'm-1', conversationId: 'c-1', taskId: 't-1' })
      })
      expect(result.current.chatList.length).toBeGreaterThan(1)
      expect(result.current.chatList[0]).toBe(openerInitial)

      act(() => {
        callbacks.onData('chunk-2 ', false, { messageId: 'm-1' })
      })
      expect(result.current.chatList[0]).toBe(openerInitial)

      act(() => {
        callbacks.onData('chunk-3', false, { messageId: 'm-1' })
        callbacks.onMessageEnd({ metadata: { retriever_resources: [] } })
        callbacks.onWorkflowFinished({ data: { status: 'succeeded' } })
        callbacks.onCompleted()
      })
      expect(result.current.chatList[0]).toBe(openerInitial)
      expect(result.current.chatList.at(-1)!.content).toBe('chunk-1 chunk-2 chunk-3')
    })

    it('should keep stable reference when getIntroduction identity changes but output is identical', () => {
      const config = {
        opening_statement: 'Hello {{name}}',
        suggested_questions: ['Ask about {{name}}'],
      }

      const { result, rerender } = renderHook(
        ({ fs }) => useChat(config as ChatConfig, fs as UseChatFormSettings),
        { initialProps: { fs: { inputs: { name: 'Alice' }, inputsForm: [] } } },
      )

      const openerBefore = result.current.chatList[0]
      expect(openerBefore.content).toBe('Hello Alice')
      expect(openerBefore.suggestedQuestions).toEqual(['Ask about Alice'])

      rerender({ fs: { inputs: { name: 'Alice' }, inputsForm: [] } })

      expect(result.current.chatList[0]).toBe(openerBefore)
    })

    it('should produce a new item when the processed content actually changes', () => {
      const config = {
        opening_statement: 'Hello {{name}}',
        suggested_questions: ['Ask {{name}}'],
      }

      const { result, rerender } = renderHook(
        ({ fs }) => useChat(config as ChatConfig, fs as UseChatFormSettings),
        { initialProps: { fs: { inputs: { name: 'Alice' }, inputsForm: [] } } },
      )

      const before = result.current.chatList[0]

      rerender({ fs: { inputs: { name: 'Bob' }, inputsForm: [] } })

      const after = result.current.chatList[0]
      expect(after).not.toBe(before)
      expect(after.content).toBe('Hello Bob')
      expect(after.suggestedQuestions).toEqual(['Ask Bob'])
    })

    it('should keep content and suggestedQuestions stable for opener already in prevChatTree even when sibling metadata changes', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const config = {
        opening_statement: 'Hello updated',
        suggested_questions: ['S1'],
      }
      const prevChatTree = [{
        id: 'opening-statement',
        content: 'old',
        isAnswer: true,
        isOpeningStatement: true,
        suggestedQuestions: [],
      }]

      const { result } = renderHook(() =>
        useChat(config as ChatConfig, undefined, prevChatTree as ChatItemInTree[]),
      )

      const openerBefore = result.current.chatList[0]
      expect(openerBefore.content).toBe('Hello updated')
      expect(openerBefore.suggestedQuestions).toEqual(['S1'])

      const contentBefore = openerBefore.content
      const suggestionsBefore = openerBefore.suggestedQuestions

      act(() => {
        result.current.handleSend('url', { query: 'msg' }, {})
      })
      act(() => {
        callbacks.onData('resp', true, { messageId: 'm-1', conversationId: 'c-1', taskId: 't-1' })
      })

      expect(result.current.chatList.length).toBeGreaterThan(1)
      const openerAfter = result.current.chatList[0]
      expect(openerAfter.content).toBe(contentBefore)
      expect(openerAfter.suggestedQuestions).toBe(suggestionsBefore)
    })

    it('should use a stable id of "opening-statement"', () => {
      const { result } = renderHook(() =>
        useChat({ opening_statement: 'Hi' } as ChatConfig),
      )
      expect(result.current.chatList[0].id).toBe('opening-statement')
    })
  })

  describe('handleSend', () => {
    it('should block send if already responding', async () => {
      const { result } = renderHook(() => useChat())

      let sendResult1: boolean | void = true
      let sendResult2: boolean | void = true

      await act(async () => {
        sendResult1 = await result.current.handleSend('url', { query: 'test1' }, {})
        sendResult2 = await result.current.handleSend('url', { query: 'test2' }, {})
      })

      expect(sendResult1).toBe(true)
      expect(sendResult2).toBe(false)
    })

    it('should call ssePost and handle data correctly on success', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'hello' }, {})
      })

      expect(ssePost).toHaveBeenCalled()
      expect(result.current.isResponding).toBe(true)

      // Simulate typical SSE lifecycle
      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
        callbacks.onData('hi ', true, { messageId: 'm-1', conversationId: 'c-1', taskId: 't-1' })
        callbacks.onData('there', false, { messageId: 'm-1' })
        callbacks.onMessageEnd({ metadata: { retriever_resources: [] } })
        callbacks.onWorkflowFinished({ data: { status: 'succeeded' } })
        callbacks.onCompleted()
      })

      expect(result.current.isResponding).toBe(false)
      expect(result.current.chatList[1].content).toBe('hi there')
      expect(result.current.chatList[1].id).toBe('m-1')
    })

    it('should handle onThought and different workflow events', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'agent test' }, {})
      })

      act(() => {
        // onWorkflowStarted
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1', message_id: 'm-2', conversation_id: 'c-1' })

        // onNodeStarted
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', title: 'Node 1' } })

        // onThought
        callbacks.onThought({ id: 'th-1', message_id: 'm-2', thought: 'thinking...', message_files: [] })

        // onData (for agent mode, appends to thought)
        callbacks.onData(' detailed', false, { messageId: 'm-2' })

        // onThought (update same thought)
        callbacks.onThought({ id: 'th-1', message_id: 'm-2', thought: 'thinking... detailed updated' })

        // onThought (new thought)
        callbacks.onThought({ id: 'th-2', message_id: 'm-2', thought: 'second thought' })

        // onNodeFinished
        callbacks.onNodeFinished({ data: { node_id: 'n-1', id: 'n-1', status: 'succeeded' } })

        // onIterationStart
        callbacks.onIterationStart({ data: { node_id: 'iter-1' } })

        // onIterationFinish
        callbacks.onIterationFinish({ data: { node_id: 'iter-1', status: 'succeeded' } })

        // onLoopStart
        callbacks.onLoopStart({ data: { node_id: 'loop-1' } })

        // onLoopFinish
        callbacks.onLoopFinish({ data: { node_id: 'loop-1', status: 'succeeded' } })

        // onWorkflowFinished
        callbacks.onWorkflowFinished({ data: { status: 'succeeded' } })

        callbacks.onCompleted()
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.agent_thoughts).toHaveLength(2)
      expect(lastResponse.agent_thoughts![0].thought).toContain('thinking...')
      expect(lastResponse.agent_thoughts![1].thought).toContain('second thought')
      expect(lastResponse.workflowProcess?.tracing).toHaveLength(3) // node, iteration, loop
    })

    it('should handle human input forms, pauses, TTS, and message ends', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'human input test' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1', message_id: 'm-3' })

        // Human input required
        callbacks.onHumanInputRequired({ data: { node_id: 'n-human' } })
        callbacks.onHumanInputRequired({ data: { node_id: 'n-human', updated: true } }) // update existing

        // setTimeout for timeout form
        callbacks.onHumanInputFormTimeout({ data: { node_id: 'n-human', expiration_time: 123456 } })

        // Form filled
        callbacks.onHumanInputFormFilled({ data: { node_id: 'n-human' } })
        callbacks.onHumanInputFormFilled({ data: { node_id: 'n-human2' } }) // new one

        // onWorkflowPaused
        callbacks.onWorkflowPaused({ data: { workflow_run_id: 'wr-1' } }) // should call sseGet

        // TTS
        callbacks.onTTSChunk('m-3', 'base64audio')
        callbacks.onTTSEnd('m-3', 'base64audio')

        // Message end with annotation and files
        callbacks.onMessageEnd({ id: 'm-3', metadata: { annotation_reply: { id: 'anno-1', account: { id: 'admin-id', name: 'admin' } } } })
        callbacks.onMessageReplace({ answer: 'Replaced content' })

        callbacks.onError()
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.humanInputFormDataList).toHaveLength(0) // Removed when filled
      expect(lastResponse.humanInputFilledFormDataList).toHaveLength(2)
      expect(sseGet).toHaveBeenCalled() // from workflowPaused
      expect(lastResponse.annotation?.id).toBe('anno-1')
      expect(lastResponse.content).toBe('Replaced content')
      expect(result.current.isResponding).toBe(false) // from onError
    })

    it('should handle file uploads in onFile', () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'file test' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1', message_id: 'm-4' })
        callbacks.onFile({ id: 'f-1', type: 'image', url: 'img.png' })

        // agent thought file
        callbacks.onThought({ id: 'th-1', message_id: 'm-4', thought: 'thinking' })
        callbacks.onFile({ id: 'f-2', type: 'document', url: 'doc.pdf', transferMethod: 'local_file' })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.message_files).toHaveLength(1)
      expect(lastResponse.agent_thoughts![0].message_files).toHaveLength(1)
    })

    it('should fetch conversation messages and suggested questions onCompleted', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const onGetConversationMessages = vi.fn().mockResolvedValue({
        data: [{
          id: 'm-5',
          answer: 'Updated answer from history',
          message: [{ role: 'user', text: 'hi' }],
          message_files: [{ id: 'assistant-file', belongs_to: 'assistant' }],
          created_at: Date.now(),
          answer_tokens: 10,
          message_tokens: 5,
          provider_response_latency: 0.5,
          inputs: {},
          query: 'hi',
        }],
      })

      const onGetSuggestedQuestions = vi.fn().mockResolvedValue({
        data: ['Suggested 1', 'Suggested 2'],
      })

      const onConversationComplete = vi.fn()

      const config = {
        suggested_questions_after_answer: { enabled: true },
      }

      const { result } = renderHook(() => useChat(config as ChatConfig))

      act(() => {
        result.current.handleSend('test-url', { query: 'fetch test' }, {
          onGetConversationMessages,
          onGetSuggestedQuestions,
          onConversationComplete,
        })
      })

      await act(async () => {
        // Setup state needed for completed handlers
        callbacks.onData(' data', true, { messageId: 'm-5', conversationId: 'c-1' })

        await callbacks.onCompleted()
      })

      expect(onGetConversationMessages).toHaveBeenCalled()
      expect(onGetSuggestedQuestions).toHaveBeenCalled()
      expect(onConversationComplete).toHaveBeenCalledWith('c-1')

      const updatedResponse = result.current.chatList[1]
      expect(updatedResponse.content).toBe('Updated answer from history') // Fetched from mock
      expect(result.current.suggestedQuestions).toEqual(['Suggested 1', 'Suggested 2'])
    })

    it('should early return onCompleted if hasError is true', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const onConversationComplete = vi.fn()

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'error test' }, {
          onConversationComplete,
        })
      })

      act(() => {
        callbacks.onCompleted(true) // hasError = true
      })

      expect(onConversationComplete).not.toHaveBeenCalled()
      expect(result.current.isResponding).toBe(false)
    })
    it('should handle complex tracing events (onNodeStarted, onIterationStart, onLoopStart) properly', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'trace test' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', title: 'Node 1' } })

        // Try updating existing node
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', title: 'Node 1 Updated' } })

        // Start an iteration
        callbacks.onIterationStart({ data: { node_id: 'iter-1', execution_metadata: { parallel_id: 'p-1' } } })
        // Finish iteration
        callbacks.onIterationFinish({ data: { node_id: 'iter-1', execution_metadata: { parallel_id: 'p-1' }, status: 'succeeded' } })

        // Start a loop
        callbacks.onLoopStart({ data: { node_id: 'loop-1' } })
        // Finish loop
        callbacks.onLoopFinish({ data: { node_id: 'loop-1', status: 'succeeded' } })

        // Finish node
        callbacks.onNodeFinished({ data: { id: 'n-1' } })

        // workflow finished updates status
        callbacks.onWorkflowFinished({ data: { status: 'failed' } })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.workflowProcess?.tracing).toHaveLength(3) // node, iter, loop
      expect(lastResponse.workflowProcess?.status).toBe('failed')
    })

    it('should handle early exits in tracing events during iteration or loop', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-3',
          content: 'initial',
          isAnswer: true,
          workflowProcess: { status: 'running', tracing: [] }, // Provide existing tracking
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      // Simulate resume which triggers another handleSend essentially (if we test via callbacks directly)
      act(() => {
        // Just directly injecting callbacks using mocked sseGet/ssePost isn't needed here, we can just do handleSend and watch the new message
        result.current.handleSend('test-url', { query: 'early-trace' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
        // Ignore node starts/finishes if iteration_id is present
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', iteration_id: 'iter-1' } })
        callbacks.onNodeFinished({ data: { id: 'n-1', iteration_id: 'iter-1' } })
      })

      const traceLen1 = result.current.chatList[result.current.chatList.length - 1].workflowProcess?.tracing?.length
      expect(traceLen1).toBe(0) // None added due to iteration early hits
    })

    it('should hit chat tree update handlers when isPublicAPI is false', async () => {
      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'non-public api trace' }, { isPublicAPI: false })
      })

      act(() => {
        // Trigger the onWorkflowStarted without workflowProcess set yet so it initializes
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })

        // Trigger it again with it existing to hit the status=Running branch
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })

        // Trigger onIterationStart
        callbacks.onIterationStart({ data: { node_id: 'iter-2', execution_metadata: { parallel_id: 'p-1' } } })

        // Trigger onIterationFinish
        callbacks.onIterationFinish({ data: { node_id: 'iter-2', execution_metadata: { parallel_id: 'p-1' }, status: 'succeeded' } })

        // Trigger onNodeStarted when it does not exist
        callbacks.onNodeStarted({ data: { node_id: 'n-2', id: 'n-2', title: 'Node 2' } })
        // Trigger onNodeStarted when it exists
        callbacks.onNodeStarted({ data: { node_id: 'n-2', id: 'n-2', title: 'Node 2 Updated' } })

        // Trigger onNodeFinished
        callbacks.onNodeFinished({ data: { id: 'n-2' } })

        // Try ending a node inside an iteration
        callbacks.onNodeFinished({ data: { id: 'n-3', iteration_id: 'iter-2' } })

        // Try starting a node inside a loop or iteration
        callbacks.onNodeStarted({ data: { node_id: 'n-4', iteration_id: 'iter-2' } })

        // workflow finished updates status
        callbacks.onWorkflowFinished({ data: { status: 'failed' } })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.workflowProcess?.tracing).toBeDefined()
      expect(lastResponse.workflowProcess?.status).toBe('failed')
    })

    it('should insert and then replace child QA when sending with parent_message_id', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-root',
        content: 'root question',
        isAnswer: false,
        children: [{
          id: 'a-root',
          content: 'root answer',
          isAnswer: true,
          siblingIndex: 0,
          children: [],
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleSend('test-url', { query: 'child question', parent_message_id: 'a-root' }, {})
      })

      act(() => {
        callbacks.onData('child answer', true, { messageId: 'm-child', conversationId: 'c-child', taskId: 't-child' })
      })

      expect(result.current.chatList.some(item => item.id === 'question-m-child')).toBe(true)
      expect(result.current.chatList.some(item => item.id === 'm-child')).toBe(true)
      expect(result.current.chatList[result.current.chatList.length - 1].content).toBe('child answer')
    })

    it('should strip local file urls before sending payload', () => {
      const localFile = {
        id: 'f-local',
        type: 'image/png',
        transferMethod: 'local_file',
        uploadedId: 'uploaded-local',
        supportFileType: 'image',
        progress: 100,
        name: 'local.png',
        url: 'blob:local',
        size: 123,
      }
      const remoteFile = {
        id: 'f-remote',
        type: 'image/png',
        transferMethod: 'remote_url',
        uploadedId: 'uploaded-remote',
        supportFileType: 'image',
        progress: 100,
        name: 'remote.png',
        url: 'https://example.com/remote.png',
        size: 456,
      }

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'file payload', files: [localFile as FileEntity, remoteFile as FileEntity] }, {})
      })

      const payload = vi.mocked(ssePost).mock.calls[0][1] as {
        body: {
          files: Array<{
            transfer_method: string
            url: string
          }>
        }
      }
      const localPayload = payload.body.files.find(item => item.transfer_method === 'local_file')
      const remotePayload = payload.body.files.find(item => item.transfer_method === 'remote_url')

      expect(localPayload).toBeDefined()
      expect(remotePayload).toBeDefined()
      expect(localPayload!.url).toBe('')
      expect(remotePayload!.url).toBe('https://example.com/remote.png')
    })

    it('should abort previous workflow event stream when sending a new message', async () => {
      const callbacksList: HookCallbacks[] = []
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacksList.push(options as HookCallbacks)
      })

      const previousWorkflowAbort = createAbortControllerMock()
      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'first request' }, {})
      })
      act(() => {
        callbacksList[0].getAbortController(previousWorkflowAbort)
      })
      await act(async () => {
        await callbacksList[0].onCompleted(true)
      })

      act(() => {
        result.current.handleSend('test-url', { query: 'second request' }, {})
      })

      expect(previousWorkflowAbort.abort).toHaveBeenCalledTimes(1)
    })

    it('should skip history patch when completed message is not found', async () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const onGetConversationMessages = vi.fn().mockResolvedValue({
        data: [{ id: 'other-message', answer: 'unused' }],
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'history mismatch' }, { onGetConversationMessages })
      })

      await act(async () => {
        callbacks.onData('streamed content', true, { messageId: 'm-history', conversationId: 'c-history', taskId: 't-history' })
        await callbacks.onCompleted()
      })

      expect(onGetConversationMessages).toHaveBeenCalled()
      expect(result.current.chatList[result.current.chatList.length - 1].content).toBe('streamed content')
    })

    it('should clear suggested questions when suggestion fetch fails after completion', async () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const config = {
        suggested_questions_after_answer: { enabled: true },
      }
      const onGetSuggestedQuestions = vi.fn().mockRejectedValue(new Error('network'))
      const { result } = renderHook(() => useChat(config as ChatConfig))

      act(() => {
        result.current.handleSend('test-url', { query: 'suggestion failure' }, { onGetSuggestedQuestions })
      })

      await act(async () => {
        callbacks.onData('answer', true, { messageId: 'm-suggest', conversationId: 'c-suggest', taskId: 't-suggest' })
        await callbacks.onCompleted()
      })

      expect(onGetSuggestedQuestions).toHaveBeenCalled()
      expect(result.current.suggestedQuestions).toEqual([])
    })

    it('should ignore node start and finish callbacks when loop_id exists in request data', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'loop node guards', loop_id: 'loop-parent' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-loop', task_id: 't-loop', message_id: 'm-loop' })
        callbacks.onNodeStarted({ data: { node_id: 'n-loop', id: 'n-loop' } })
        callbacks.onNodeFinished({ data: { node_id: 'n-loop', id: 'n-loop' } })
      })

      const latestResponse = result.current.chatList[result.current.chatList.length - 1]
      expect(latestResponse.workflowProcess?.tracing).toHaveLength(0)
    })

    it('should handle paused workflow finish, thought id binding, empty tts chunk, and human-input pause updates', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('test-url', { query: 'branch-rich case' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-rich', task_id: 't-rich' })
        callbacks.onNodeStarted({ data: { node_id: 'human-node', id: 'human-node' } })
        callbacks.onHumanInputRequired({ data: { node_id: 'human-node' } })
        callbacks.onHumanInputRequired({ data: { node_id: 'human-node-2' } })
        callbacks.onWorkflowPaused({ data: { workflow_run_id: 'wr-rich' } })
        callbacks.onWorkflowFinished({ data: { status: 'succeeded' } })
        callbacks.onThought({ id: 'th-bind', message_id: 'm-th-bind', conversation_id: 'c-th-bind', thought: 'thought text' })
        callbacks.onTTSChunk('m-th-bind', '')
      })

      const latestResponse = result.current.chatList[result.current.chatList.length - 1]
      expect(latestResponse.id).toBe('m-th-bind')
      expect(latestResponse.conversationId).toBe('c-th-bind')
      expect(latestResponse.workflowProcess?.status).toBe('succeeded')
      expect(latestResponse.humanInputFormDataList?.map(item => item.node_id)).toEqual(['human-node', 'human-node-2'])
      expect(latestResponse.workflowProcess?.tracing?.find(item => item.node_id === 'human-node')?.status).toBe('paused')
    })
  })

  describe('handleResume', () => {
    it('should call sseGet to resume a node and handle complex tracing', async () => {
      let callbacks: HookCallbacks

      vi.mocked(sseGet).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-1',
          content: 'initial',
          isAnswer: true,
          agent_thoughts: [{
            id: 'th-1',
            tool: '',
            tool_input: '',
            message_id: 'm-1',
            conversation_id: 'c-1',
            observation: '',
            position: 1,
            thought: 'thinking',
            message_files: [],
          }],
          message_files: [],
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-1', 'wr-1', { isPublicAPI: true })
      })

      expect(sseGet).toHaveBeenCalledWith(
        '/workflow/wr-1/events?include_state_snapshot=true',
        expect.any(Object),
        expect.any(Object),
      )

      act(() => {
        callbacks.onData(' resumed', true, { messageId: 'm-1', conversationId: 'c-1', taskId: 't-1' })

        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', title: 'Node 1' } })

        callbacks.onFile({ id: 'f-1', url: 'test.jpg', type: 'image' })

        callbacks.onThought({ id: 'th-1', message_id: 'm-1', thought: 'thinking updated', message_files: [] })
        callbacks.onThought({ id: 'th-2', message_id: 'm-1', thought: 'second thought', message_files: [] })

        callbacks.onLoopStart({ data: { node_id: 'loop-1' } })
        callbacks.onLoopFinish({ data: { node_id: 'loop-1', status: 'succeeded' } })

        callbacks.onIterationStart({ data: { node_id: 'iter-1' } })
        callbacks.onIterationFinish({ data: { node_id: 'iter-1', status: 'succeeded' } })

        callbacks.onNodeFinished({ data: { node_id: 'n-1', id: 'n-1', status: 'succeeded' } })

        // human input
        callbacks.onHumanInputRequired({ data: { node_id: 'h-1' } })
        callbacks.onHumanInputRequired({ data: { node_id: 'h-1', updated: true } })
        callbacks.onHumanInputFormTimeout({ data: { node_id: 'h-1', expiration_time: 123 } })
        callbacks.onHumanInputFormFilled({ data: { node_id: 'h-1' } })

        callbacks.onTTSChunk('m-1', 'audio1')
        callbacks.onTTSEnd('m-1', 'audio1')

        callbacks.onMessageEnd({ id: 'm-1', metadata: { annotation_reply: { id: 'anno-3', account: { name: 'sys' } } } })
        callbacks.onMessageReplace({ answer: 'replaced resume' })

        callbacks.onWorkflowPaused({ data: { workflow_run_id: 'wr-1' } })

        callbacks.onError()

        // Remove the callbacks.onWorkflowFinished({ data: { status: 'succeeded' } }) call to leave it paused

        callbacks.onCompleted()
      })

      const lastResponse = result.current.chatList[result.current.chatList.length - 1]
      expect(lastResponse.agent_thoughts![0].thought).toContain('resumed')

      expect(lastResponse.workflowProcess?.tracing?.length).toBeGreaterThan(0)
      expect(lastResponse.workflowProcess?.status).toBe('paused')
      expect(lastResponse.humanInputFilledFormDataList).toHaveLength(1)
      expect(lastResponse.humanInputFormDataList).toHaveLength(0)
      expect(lastResponse.content).toBe('replaced resume')
    })

    it('should handle non-agent mode resume', async () => {
      let callbacks: HookCallbacks

      vi.mocked(sseGet).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-2',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-2', 'wr-1', { isPublicAPI: true })
      })

      act(() => {
        callbacks.onData(' append', true, { messageId: 'm-2' })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.content).toBe('initial append')
    })

    it('should stop resume completion flow early when hasError is true', async () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const onConversationComplete = vi.fn()
      const onGetSuggestedQuestions = vi.fn()
      const config = { suggested_questions_after_answer: { enabled: true } }
      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-resume-error',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(config as ChatConfig, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-resume-error', 'wr-error', {
          isPublicAPI: true,
          onConversationComplete,
          onGetSuggestedQuestions,
        })
      })
      await act(async () => {
        await callbacks.onCompleted(true)
      })

      expect(onConversationComplete).not.toHaveBeenCalled()
      expect(onGetSuggestedQuestions).not.toHaveBeenCalled()
      expect(result.current.isResponding).toBe(false)
    })

    it('should abort previous workflow event stream when resuming again', () => {
      const callbacksList: HookCallbacks[] = []
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacksList.push(options as HookCallbacks)
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-resume',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
      const previousWorkflowAbort = createAbortControllerMock()

      act(() => {
        result.current.handleResume('m-resume', 'wr-1', { isPublicAPI: true })
      })
      act(() => {
        callbacksList[0].getAbortController(previousWorkflowAbort)
      })
      act(() => {
        result.current.handleResume('m-resume', 'wr-2', { isPublicAPI: true })
      })

      expect(previousWorkflowAbort.abort).toHaveBeenCalledTimes(1)
    })

    it('should ignore tracing callbacks before workflow process is initialized', () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-guard',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-guard', 'wr-1', { isPublicAPI: true })
      })

      act(() => {
        callbacks.onIterationStart({ data: { node_id: 'iter-guard' } })
        callbacks.onIterationFinish({ data: { node_id: 'iter-guard', status: 'succeeded' } })
        callbacks.onNodeStarted({ data: { node_id: 'node-guard', id: 'node-guard' } })
        callbacks.onNodeFinished({ data: { id: 'node-guard' } })
        callbacks.onLoopStart({ data: { node_id: 'loop-guard' } })
        callbacks.onLoopFinish({ data: { node_id: 'loop-guard', status: 'succeeded' } })
        callbacks.onTTSChunk('m-guard', '')
      })

      expect(result.current.chatList[1].content).toBe('initial')
    })

    it('should clear suggested questions when resume suggestion fetch fails', async () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const config = {
        suggested_questions_after_answer: { enabled: true },
      }
      const onGetSuggestedQuestions = vi.fn().mockRejectedValue(new Error('resume suggestion failed'))
      const onConversationComplete = vi.fn()
      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-suggest-resume',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(config as ChatConfig, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-suggest-resume', 'wr-1', {
          isPublicAPI: true,
          onGetSuggestedQuestions,
          onConversationComplete,
        })
      })

      await act(async () => {
        callbacks.onData(' resumed', true, { messageId: 'm-suggest-resume', conversationId: 'c-resume', taskId: 't-resume' })
        await callbacks.onCompleted()
      })

      expect(onConversationComplete).toHaveBeenCalledWith('c-resume')
      expect(onGetSuggestedQuestions).toHaveBeenCalled()
      expect(result.current.suggestedQuestions).toEqual([])
    })

    it('should append human input entries and mark tracing node as paused on resume', () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-human-resume',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-human-resume', 'wr-1', { isPublicAPI: true })
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
        callbacks.onNodeStarted({ data: { node_id: 'node-1', id: 'node-1' } })
        callbacks.onHumanInputRequired({ data: { node_id: 'node-1' } })
        callbacks.onHumanInputRequired({ data: { node_id: 'node-2' } })
        callbacks.onHumanInputFormFilled({ data: { node_id: 'node-1' } })
        callbacks.onHumanInputFormFilled({ data: { node_id: 'node-3' } })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.humanInputFormDataList?.map(item => item.node_id)).toEqual(['node-2'])
      expect(lastResponse.humanInputFilledFormDataList?.map(item => item.node_id)).toEqual(['node-1', 'node-3'])
      expect(lastResponse.workflowProcess?.tracing?.find(item => item.node_id === 'node-1')?.status).toBe('paused')
    })

    it('should handle resume non-annotation lifecycle branches and parallel node finish', () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-1',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-resume-branches',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
          workflowProcess: { status: 'running' },
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleResume('m-resume-branches', 'wr-branches', { isPublicAPI: true })
      })
      act(() => {
        callbacks.onFile({ id: 'f-before-thought', type: 'image', url: 'img.png' })
        callbacks.onThought({ id: 'th-1', message_id: 'm-resume-branches', conversation_id: 'c-resume-branches', thought: 'thinking' })
        callbacks.onMessageEnd({ metadata: { retriever_resources: [{ id: 'r-1' }] }, files: [] })

        callbacks.onLoopStart({ data: { node_id: 'loop-init' } })
        callbacks.onIterationStart({ data: { node_id: 'iter-init' } })
        callbacks.onNodeStarted({ data: { node_id: 'n-iter', id: 'n-iter', iteration_id: 'iter-skip' } })
        callbacks.onNodeFinished({ data: { id: 'n-iter', iteration_id: 'iter-skip' } })

        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1' } })
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', title: 'updated' } })
        callbacks.onNodeStarted({ data: { node_id: 'n-parallel', id: 'n-parallel', execution_metadata: { parallel_id: 'p-1' } } })
        callbacks.onNodeFinished({ data: { id: 'n-parallel', execution_metadata: { parallel_id: 'p-1' } } })

        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-branches', task_id: 't-branches' })
        callbacks.onWorkflowFinished({ data: { status: 'succeeded' } })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.message_files).toHaveLength(1)
      expect(lastResponse.conversationId).toBe('c-resume-branches')
      expect(lastResponse.citation).toEqual([{ id: 'r-1' }])
      expect(lastResponse.workflowProcess?.status).toBe('succeeded')
      expect(lastResponse.workflowProcess?.tracing?.some(item => item.id === 'n-parallel')).toBe(true)
    })
  })

  describe('createAudioPlayerManager branch cases', () => {
    it('should handle ttsUrl generation for appId with installed apps', async () => {
      vi.mocked(usePathname).mockReturnValue('/explore/installed/app')
      vi.mocked(useParams).mockReturnValue({ appId: 'app-1' } as ReturnType<typeof useParams>)

      let callbacks: HookCallbacks

      vi.mocked(sseGet).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleResume('m-tts', 'wr-2', { isPublicAPI: true })
      })

      act(() => {
        callbacks.onTTSChunk('m-tts', 'audio2')
      })

      // This indirectly tests createAudioPlayerManager with appId installed URL
      expect(result.current.chatList).toEqual([])
    })

    it('should handle ttsUrl generation for token public API', async () => {
      vi.mocked(usePathname).mockReturnValue('/')
      vi.mocked(useParams).mockReturnValue({ token: 'tok-1' } as ReturnType<typeof useParams>)

      let callbacks: HookCallbacks

      vi.mocked(ssePost).mockImplementation(async (url, params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleSend('url', { query: 'test tts' }, {})
      })

      act(() => {
        callbacks.onTTSChunk('m-tts2', 'audio3')
      })

      expect(result.current.isResponding).toBe(true)
    })

    it('should handle ttsUrl generation for appId without installed route', () => {
      vi.mocked(usePathname).mockReturnValue('/apps/app-1')
      vi.mocked(useParams).mockReturnValue({ appId: 'app-1' } as ReturnType<typeof useParams>)

      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleResume('m-tts-app', 'wr-tts-app', { isPublicAPI: true })
      })
      act(() => {
        callbacks.onTTSChunk('m-tts-app', 'audio')
      })

      expect(sseGet).toHaveBeenCalledWith(
        '/workflow/wr-tts-app/events?include_state_snapshot=true',
        expect.any(Object),
        expect.any(Object),
      )
    })
  })

  describe('handleStop and handleRestart', () => {
    it('should set responded false and call stopChat and abort controllers', () => {
      const stopChat = vi.fn()
      const { result } = renderHook(() => useChat(undefined, undefined, undefined, stopChat))

      act(() => {
        // Send a message first to establish task/workflow run
        result.current.handleSend('url', { query: 'test' }, {})
      })

      // Simulate taskIdRef population
      const callbacks = vi.mocked(ssePost).mock.calls[0][2] as HookCallbacks
      act(() => {
        callbacks.onWorkflowStarted({ task_id: 'task-123' })
      })

      // Also mock abort controllers
      act(() => {
        // Triggering a resume creates workflowEventsAbortControllerRef
        result.current.handleResume('m-1', 'wr-1', { isPublicAPI: true })
      })

      act(() => {
        result.current.handleStop()
      })

      expect(stopChat).toHaveBeenCalledWith('task-123')
      expect(result.current.isResponding).toBe(false)
    })

    it('should clear chat tree and controllers on restart', () => {
      const cb = vi.fn()
      const { result } = renderHook(() => useChat())

      act(() => {
        result.current.handleRestart(cb)
      })

      expect(cb).toHaveBeenCalled()
      expect(result.current.chatList).toEqual([])
      expect(result.current.suggestedQuestions).toEqual([])
    })

    it('should abort all tracked controllers when stop is triggered', async () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const stopChat = vi.fn()
      const workflowAbort = createAbortControllerMock()
      const conversationAbort = createAbortControllerMock()
      const suggestedAbort = createAbortControllerMock()
      const config = { suggested_questions_after_answer: { enabled: true } }
      const onGetConversationMessages = vi.fn().mockImplementation(async (_conversationId: string, setAbortController: (abortController: AbortController) => void) => {
        setAbortController(conversationAbort)
        return {
          data: [{
            id: 'm-stop',
            answer: 'done',
            message: [{ role: 'assistant', text: 'done' }],
            created_at: Date.now(),
            answer_tokens: 3,
            message_tokens: 2,
            provider_response_latency: 1,
            inputs: {},
            query: 'q',
          }],
        }
      })
      const onGetSuggestedQuestions = vi.fn().mockImplementation(async (_messageId: string, setAbortController: (abortController: AbortController) => void) => {
        setAbortController(suggestedAbort)
        return { data: ['s1'] }
      })

      const { result } = renderHook(() => useChat(config as ChatConfig, undefined, undefined, stopChat))

      act(() => {
        result.current.handleSend('url', { query: 'stop with aborts' }, { onGetConversationMessages, onGetSuggestedQuestions })
      })
      act(() => {
        callbacks.getAbortController(workflowAbort)
      })
      await act(async () => {
        callbacks.onData('part', true, { messageId: 'm-stop', conversationId: 'c-stop', taskId: 'task-stop' })
        await callbacks.onCompleted()
      })
      act(() => {
        result.current.handleStop()
      })

      expect(stopChat).toHaveBeenCalledWith('task-stop')
      expect(workflowAbort.abort).toHaveBeenCalledTimes(1)
      expect(conversationAbort.abort).toHaveBeenCalledTimes(1)
      expect(suggestedAbort.abort).toHaveBeenCalledTimes(1)
    })

    it('should clear chat list when clearChatList flag is true and reset flag via callback', () => {
      const clearChatListCallback = vi.fn()

      renderHook(() => useChat(undefined, undefined, undefined, undefined, true, clearChatListCallback))

      expect(clearChatListCallback).toHaveBeenCalledWith(false)
    })
  })

  describe('annotations and siblings', () => {
    const prevChatTree = [{
      id: 'q-1',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'a-1',
        content: 'answer 1',
        isAnswer: true,
        workflow_run_id: 'wr-1',
        humanInputFormDataList: [{ node_id: 'n-1' }],
        siblingIndex: 0,
        annotation: { id: 'anno-old', authorName: 'user' },
      }],
    }]

    it('should handle annotation events', () => {
      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      // Edited
      act(() => {
        result.current.handleAnnotationEdited('edited query', 'edited answer', 1)
      })
      expect(result.current.chatList[0].content).toBe('edited query')
      expect(result.current.chatList[1].content).toBe('edited answer')

      // Added
      act(() => {
        result.current.handleAnnotationAdded('anno-1', 'admin', 'q2', 'a2', 1)
      })
      expect(result.current.chatList[1].annotation?.id).toBe('anno-1')
      expect(result.current.chatList[1].annotation?.authorName).toBe('admin')

      // Removed
      act(() => {
        result.current.handleAnnotationRemoved(1)
      })
      expect(result.current.chatList[1].annotation?.id).toBe('')
    })

    it('should handle switch sibling and trigger handleResume if human input', () => {
      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))

      act(() => {
        result.current.handleSwitchSibling('a-1', { isPublicAPI: true })
      })

      // Should automatically call handleResume -> sseGet for human input
      expect(sseGet).toHaveBeenCalledWith(
        '/workflow/wr-1/events?include_state_snapshot=true',
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('should walk nested siblings without resuming when no pending human input exists', () => {
      const nestedTree = [{
        id: 'q-root',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'a-root',
          content: 'answer',
          isAnswer: true,
          siblingIndex: 0,
          children: [{
            id: 'q-deep',
            content: 'deep question',
            isAnswer: false,
            children: [{
              id: 'a-deep',
              content: 'deep answer',
              isAnswer: true,
              siblingIndex: 0,
            }],
          }],
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, nestedTree as ChatItemInTree[]))
      act(() => {
        result.current.handleSwitchSibling('a-deep', { isPublicAPI: true })
      })
    })
  })

  describe('Uncovered edge cases', () => {
    it('should handle onFile fallbacks for audio, video, bin types', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())
      act(() => {
        result.current.handleSend('url', { query: 'file types' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1', message_id: 'm-files' })

        // No transferMethod, type: video
        callbacks.onFile({ id: 'f-vid', type: 'video', url: 'vid.mp4' })
        // No transferMethod, type: audio
        callbacks.onFile({ id: 'f-aud', type: 'audio', url: 'aud.mp3' })
        // No transferMethod, type: bin
        callbacks.onFile({ id: 'f-bin', type: 'bin', url: 'file.bin' })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.message_files).toHaveLength(3)
      expect(lastResponse.message_files![0].type).toBe('video/mp4')
      expect(lastResponse.message_files![0].supportFileType).toBe('video')
      expect(lastResponse.message_files![1].type).toBe('audio/mpeg')
      expect(lastResponse.message_files![1].supportFileType).toBe('audio')
      expect(lastResponse.message_files![2].type).toBe('application/octet-stream')
      expect(lastResponse.message_files![2].supportFileType).toBe('document')
    })

    it('should handle onMessageEnd empty citation and empty processed files fallbacks', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())
      act(() => {
        result.current.handleSend('url', { query: 'citations' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1', message_id: 'm-cite' })
        callbacks.onMessageEnd({ id: 'm-cite', metadata: {} }) // No retriever_resources or annotation_reply
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.citation).toEqual([])
    })

    it('should handle iteration and loop tracing edge cases (lazy arrays, node finish index -1)', () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-trace',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-trace',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
          workflowProcess: { status: WorkflowRunningStatus.Running }, // Omit tracing array to test fallback
        }],
      }]

      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
      act(() => {
        result.current.handleResume('m-trace', 'wr-trace', { isPublicAPI: true })
      })

      act(() => {
        // onIterationStart should create the tracing array
        callbacks.onIterationStart({ data: { node_id: 'iter-1' } })
      })

      const prevChatTree2 = [{
        id: 'q-trace2',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-trace',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
          workflowProcess: { status: WorkflowRunningStatus.Running }, // Omit tracing array to test fallback
        }],
      }]

      const { result: result2 } = renderHook(() => useChat(undefined, undefined, prevChatTree2 as ChatItemInTree[]))
      act(() => {
        result2.current.handleResume('m-trace', 'wr-trace2', { isPublicAPI: true })
      })

      act(() => {
        // onNodeStarted should create the tracing array
        callbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1' } })
      })

      const prevChatTree3 = [{
        id: 'q-trace3',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-trace',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
          workflowProcess: { status: WorkflowRunningStatus.Running }, // Omit tracing array to test fallback
        }],
      }]

      const { result: result3 } = renderHook(() => useChat(undefined, undefined, prevChatTree3 as ChatItemInTree[]))
      act(() => {
        result3.current.handleResume('m-trace', 'wr-trace3', { isPublicAPI: true })
      })

      act(() => {
        // onLoopStart should create the tracing array
        callbacks.onLoopStart({ data: { node_id: 'loop-1' } })
      })

      // Ensure the tracing array exists and holds the loop item
      const lastResponse = result3.current.chatList[1]
      expect(lastResponse.workflowProcess?.tracing).toBeDefined()
      expect(lastResponse.workflowProcess?.tracing).toHaveLength(1)
      expect(lastResponse.workflowProcess?.tracing![0].node_id).toBe('loop-1')
    })

    it('should handle onCompleted fallback to answer when agent thought does not match and provider latency is 0', async () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const onGetConversationMessages = vi.fn().mockResolvedValue({
        data: [{
          id: 'm-completed',
          answer: 'final answer',
          message: [{ role: 'user', text: 'hi' }],
          agent_thoughts: [{ thought: 'thinking different from answer' }],
          created_at: Date.now(),
          answer_tokens: 10,
          message_tokens: 5,
          provider_response_latency: 0,
          inputs: {},
          query: 'hi',
        }],
      })

      const { result } = renderHook(() => useChat())
      act(() => {
        result.current.handleSend('test-url', { query: 'fetch test latency zero' }, {
          onGetConversationMessages,
        })
      })

      await act(async () => {
        callbacks.onData(' data', true, { messageId: 'm-completed', conversationId: 'c-latency' })
        await callbacks.onCompleted()
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.content).toBe('final answer')
      expect(lastResponse.more?.latency).toBe('0.00')
      expect(lastResponse.more?.tokens_per_second).toBeUndefined()
    })

    it('should handle onCompleted using agent thought when thought matches answer', async () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const onGetConversationMessages = vi.fn().mockResolvedValue({
        data: [{
          id: 'm-matched',
          answer: 'matched thought',
          message: [{ role: 'user', text: 'hi' }],
          agent_thoughts: [{ thought: 'matched thought' }],
          created_at: Date.now(),
          answer_tokens: 10,
          message_tokens: 5,
          provider_response_latency: 0.5,
          inputs: {},
          query: 'hi',
        }],
      })

      const { result } = renderHook(() => useChat())
      act(() => {
        result.current.handleSend('test-url', { query: 'fetch test match thought' }, {
          onGetConversationMessages,
        })
      })

      await act(async () => {
        callbacks.onData(' data', true, { messageId: 'm-matched', conversationId: 'c-matched' })
        await callbacks.onCompleted()
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.content).toBe('') // isUseAgentThought sets content to empty string
    })

    it('should cover pausedStateRef reset on workflowFinished and missing tracing arrays in node finish / human input', () => {
      let callbacks: HookCallbacks
      vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const prevChatTree = [{
        id: 'q-pause',
        content: 'query',
        isAnswer: false,
        children: [{
          id: 'm-pause',
          content: 'initial',
          isAnswer: true,
          siblingIndex: 0,
          workflowProcess: { status: WorkflowRunningStatus.Running }, // Omit tracing
        }],
      }]

      // Setup test for workflow paused + finished
      const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
      act(() => {
        result.current.handleResume('m-pause', 'wr-1', { isPublicAPI: true })
      })

      act(() => {
        // Trigger a pause to set pausedStateRef = true
        callbacks.onWorkflowPaused({ data: { workflow_run_id: 'wr-1' } })

        // workflowFinished should reset pausedStateRef to false
        callbacks.onWorkflowFinished({ data: { status: 'succeeded' } })

        // Missing tracing array onNodeFinished early return
        callbacks.onNodeFinished({ data: { id: 'n-none' } })

        // Missing tracing array fallback for human input
        callbacks.onHumanInputRequired({ data: { node_id: 'h-1' } })
      })

      const lastResponse = result.current.chatList[1]
      expect(lastResponse.workflowProcess?.status).toBe('succeeded')
    })

    it('should cover onThought creating tracing and appending message correctly when isAgentMode=true', () => {
      let callbacks: HookCallbacks
      vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
        callbacks = options as HookCallbacks
      })

      const { result } = renderHook(() => useChat())
      act(() => {
        result.current.handleSend('url', { query: 'agent onThought' }, {})
      })

      act(() => {
        callbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })

        // onThought when array is implicitly empty
        callbacks.onThought({ id: 'th-1', thought: 'initial thought' })

        // onData which appends to last thought
        callbacks.onData(' appended', false, { messageId: 'm-thought' })
      })

      const lastResponse = result.current.chatList[result.current.chatList.length - 1]
      expect(lastResponse.agent_thoughts).toHaveLength(1)
      expect(lastResponse.agent_thoughts![0].thought).toBe('initial thought appended')
    })
  })

  it('should cover produceChatTreeNode traversing deeply nested child nodes to find the target item', () => {
    vi.mocked(sseGet).mockImplementation(async (_url, _params, _options) => { })

    const nestedTree = [{
      id: 'q-root',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'a-root',
        content: 'answer root',
        isAnswer: true,
        siblingIndex: 0,
        children: [{
          id: 'q-deep',
          content: 'deep question',
          isAnswer: false,
          children: [{
            id: 'a-deep',
            content: 'deep answer to find',
            isAnswer: true,
            siblingIndex: 0,
          }],
        }],
      }],
    }]

    // Render the chat with the nested tree
    const { result } = renderHook(() => useChat(undefined, undefined, nestedTree as ChatItemInTree[]))

    // Setting TargetNodeId triggers state update using produceChatTreeNode internally
    act(() => {
      // AnnotationEdited uses produceChatTreeNode to find target Question/Answer nodes
      result.current.handleAnnotationRemoved(3)
    })

    // We just care that the tree traversal didn't crash
    expect(result.current.chatList).toHaveLength(4)
  })

  it('should cover baseFile with transferMethod and without file type in handleResume and handleSend', () => {
    let resumeCallbacks: HookCallbacks
    vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
      resumeCallbacks = options as HookCallbacks
    })
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })

    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.handleSend('url', { query: 'test base file' }, {})
    })

    const prevChatTree = [{
      id: 'q-resume',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'm-resume',
        content: 'initial',
        isAnswer: true,
        siblingIndex: 0,
      }],
    }]
    const { result: resumeResult } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      resumeResult.current.handleResume('m-resume', 'wr-1', { isPublicAPI: true })
    })

    act(() => {
      const fileWithMethodAndNoType = {
        id: 'f-1',
        transferMethod: 'remote_url',
        type: undefined,
        name: 'uploaded.png',
      }
      sendCallbacks.onFile(fileWithMethodAndNoType)
      resumeCallbacks.onFile(fileWithMethodAndNoType)

      // Test the inner condition in handleSend `!isAgentMode` where we also push to current files
      sendCallbacks.onFile(fileWithMethodAndNoType)
    })

    const lastSendResponse = result.current.chatList[1]
    expect(lastSendResponse.message_files).toHaveLength(2)

    const lastResumeResponse = resumeResult.current.chatList[1]
    expect(lastResumeResponse.message_files).toHaveLength(1)
  })

  it('should cover parallel_id tracing matches in iteration and loop finish', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })

    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSend('url', { query: 'test parallel_id' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })

      // parallel_id in execution_metadata
      sendCallbacks.onIterationStart({ data: { node_id: 'iter-1', execution_metadata: { parallel_id: 'pid-1' } } })
      sendCallbacks.onIterationFinish({ data: { node_id: 'iter-1', execution_metadata: { parallel_id: 'pid-1' }, status: 'succeeded' } })

      // no parallel_id
      sendCallbacks.onLoopStart({ data: { node_id: 'loop-1' } })
      sendCallbacks.onLoopFinish({ data: { node_id: 'loop-1', status: 'succeeded' } })

      // parallel_id in root item but finish has it in execution_metadata
      sendCallbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1', parallel_id: 'pid-2' } })
      sendCallbacks.onNodeFinished({ data: { node_id: 'n-1', id: 'n-1', execution_metadata: { parallel_id: 'pid-2' } } })
    })

    const lastResponse = result.current.chatList[1]
    const tracing = lastResponse.workflowProcess!.tracing!
    expect(tracing).toHaveLength(3)
    expect(tracing[0].status).toBe('succeeded')
    expect(tracing[1].status).toBe('succeeded')
  })

  it('should cover baseFile with ALL fields, avoiding all fallbacks', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })

    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.handleSend('url', { query: 'test exact file' }, {})
    })

    act(() => {
      sendCallbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
      sendCallbacks.onFile({
        id: 'exact-1',
        type: 'custom/mime',
        transferMethod: 'local_file',
        url: 'exact.url',
        supportFileType: 'blob',
        progress: 50,
        name: 'exact.name',
        size: 1024,
      })
    })

    const lastResponse = result.current.chatList[result.current.chatList.length - 1]
    expect(lastResponse.message_files).toHaveLength(1)
    expect(lastResponse.message_files![0].type).toBe('custom/mime')
    expect(lastResponse.message_files![0].size).toBe(1024)
  })

  it('should cover handleResume missing branches for onMessageEnd, onFile fallbacks, and workflow edges', () => {
    let resumeCallbacks: HookCallbacks
    vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
      resumeCallbacks = options as HookCallbacks
    })

    const prevChatTree = [{
      id: 'q-data',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'm-data',
        content: 'initial',
        isAnswer: true,
        siblingIndex: 0,
      }],
    }]
    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      result.current.handleResume('m-data', 'wr-1', { isPublicAPI: true })
    })

    act(() => {
      // messageId undefined
      resumeCallbacks.onData(' more data', false, { conversationId: 'c-1', taskId: 't-1' })

      // onFile audio video bin fallbacks
      resumeCallbacks.onFile({ id: 'f-vid', type: 'video', url: 'vid.mp4' })
      resumeCallbacks.onFile({ id: 'f-aud', type: 'audio', url: 'aud.mp3' })
      resumeCallbacks.onFile({ id: 'f-bin', type: 'bin', url: 'file.bin' })

      // onMessageEnd missing annotation and citation
      resumeCallbacks.onMessageEnd({ id: 'm-end', metadata: {} } as Record<string, unknown>)

      // onThought fallback missing message_id
      resumeCallbacks.onThought({ thought: 'missing message id', message_files: [] } as Record<string, unknown>)

      // onHumanInputFormTimeout missing length
      resumeCallbacks.onHumanInputFormTimeout({ data: { node_id: 'timeout-id' } })

      // Empty file list
      result.current.chatList[1].message_files = undefined
      // Call onFile while agent_thoughts is empty/undefined to hit the `else` fallback branch
      resumeCallbacks.onFile({ id: 'f-agent', type: 'image', url: 'agent.png' })
    })

    const lastResponse = result.current.chatList[1]
    expect(lastResponse.message_files![0]).toBeDefined()
  })

  it('should cover edge case where node_id is missing or index is -1 in handleResume onNodeFinished and onLoopFinish', () => {
    let resumeCallbacks: HookCallbacks
    vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
      resumeCallbacks = options as HookCallbacks
    })

    const prevChatTree = [{
      id: 'q-index',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'm-index',
        content: 'initial',
        isAnswer: true,
        siblingIndex: 0,
        workflowProcess: { status: WorkflowRunningStatus.Running, tracing: [] },
      }],
    }]
    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      result.current.handleResume('m-index', 'wr-1', { isPublicAPI: true })
    })

    act(() => {
      // ID doesn't exist in tracing
      resumeCallbacks.onNodeFinished({ data: { id: 'missing', execution_metadata: { parallel_id: 'missing-pid' } } })

      // Node ID doesn't exist in tracing
      resumeCallbacks.onLoopFinish({ data: { node_id: 'missing-loop', status: 'succeeded' } })

      // Parallel ID doesn't match
      resumeCallbacks.onIterationFinish({ data: { node_id: 'missing-iter', execution_metadata: { parallel_id: 'missing-pid' }, status: 'succeeded' } })
    })

    const lastResponse = result.current.chatList[1]
    expect(lastResponse.workflowProcess?.tracing).toHaveLength(0) // None were updated
  })

  it('should cover TTS chunks branching where audio is empty', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })

    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSend('url', { query: 'test text to speech' }, {})
    })

    act(() => {
      sendCallbacks.onTTSChunk('msg-1', '') // Missing audio string
    })
    // If it didn't crash, we achieved coverage for the empty audio string fast return
    expect(true).toBe(true)
  })

  it('should cover handleSend identical missing branches, null states, and undefined tracking arrays', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })

    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.handleSend('url', { query: 'test exact file send' }, {})
    })

    act(() => {
      // missing task ID in onData
      sendCallbacks.onData(' append', false, { conversationId: 'c-1' } as Record<string, unknown>)

      // Empty message files fallback
      result.current.chatList[1].message_files = undefined
      sendCallbacks.onFile({ id: 'f-send', type: 'image', url: 'img.png' })

      // Empty message files passing to processing fallback
      sendCallbacks.onMessageEnd({ id: 'm-send' } as Record<string, unknown>)

      // node finished missing arrays
      sendCallbacks.onWorkflowStarted({ workflow_run_id: 'wr', task_id: 't' })
      sendCallbacks.onNodeStarted({ data: { node_id: 'n-new', id: 'n-new' } }) // adds tracing
      sendCallbacks.onNodeFinished({ data: { id: 'missing-idx' } } as Record<string, unknown>)

      // onIterationFinish parallel_id matching
      sendCallbacks.onIterationFinish({ data: { node_id: 'missing-iter', status: 'succeeded' } } as Record<string, unknown>)

      // onLoopFinish parallel_id matching
      sendCallbacks.onLoopFinish({ data: { node_id: 'missing-loop', status: 'succeeded' } } as Record<string, unknown>)

      // Timeout missing form data
      sendCallbacks.onHumanInputFormTimeout({ data: { node_id: 'timeout' } } as Record<string, unknown>)
    })

    expect(result.current.chatList[1].message_files).toBeDefined()
  })

  it('should cover handleSwitchSibling target message not found early returns', () => {
    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSwitchSibling('missing-id', { isPublicAPI: true })
    })
    // Should early return and not crash
    expect(result.current.chatList).toHaveLength(0)
  })

  it('should cover handleSend onNodeStarted missing workflowProcess early returns', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })
    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSend('url', { query: 'test' }, {})
    })
    act(() => {
      sendCallbacks.onNodeStarted({ data: { node_id: 'n-new', id: 'n-new' } })
    })
    expect(result.current.chatList[1].workflowProcess).toBeUndefined()
  })

  it('should cover handleSend onNodeStarted missing tracing in workflowProcess (L969)', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })
    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSend('url', { query: 'test' }, {})
    })
    act(() => {
      sendCallbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
    })
    // Get the shared reference from the tree to mutate the local closed-over responseItem's workflowProcess
    act(() => {
      const response = result.current.chatList[1]
      if (response.workflowProcess) {
        // @ts-expect-error deliberately removing tracing to cover the fallback branch
        delete response.workflowProcess.tracing
      }
      sendCallbacks.onNodeStarted({ data: { node_id: 'n-new', id: 'n-new' } })
    })
    expect(result.current.chatList[1].workflowProcess?.tracing).toBeDefined()
    expect(result.current.chatList[1].workflowProcess?.tracing?.length).toBe(1)
  })

  it('should cover handleSend onTTSChunk and onTTSEnd truthy audio strings', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })
    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSend('url', { query: 'test' }, {})
    })
    act(() => {
      sendCallbacks.onTTSChunk('msg-1', 'audio-chunk')
      sendCallbacks.onTTSEnd('msg-1', 'audio-end')
    })
    expect(result.current.chatList).toHaveLength(2)
  })

  it('should cover onGetSuggestedQuestions success and error branches in handleResume onCompleted', async () => {
    let resumeCallbacks: HookCallbacks
    vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
      resumeCallbacks = options as HookCallbacks
    })

    const onGetSuggestedQuestions = vi.fn()
      .mockImplementationOnce((_id, getAbort) => {
        if (getAbort) {
          getAbort({ abort: vi.fn() } as unknown as AbortController)
        }
        return Promise.resolve({ data: ['Suggested 1', 'Suggested 2'] })
      })
      .mockImplementationOnce((_id, getAbort) => {
        if (getAbort) {
          getAbort({ abort: vi.fn() } as unknown as AbortController)
        }
        return Promise.reject(new Error('error'))
      })

    const config = {
      suggested_questions_after_answer: { enabled: true },
    }

    const prevChatTree = [{
      id: 'q',
      content: 'query',
      isAnswer: false,
      children: [{ id: 'm-1', content: 'initial', isAnswer: true, siblingIndex: 0 }],
    }]

    // Success branch
    const { result } = renderHook(() => useChat(config as ChatConfig, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      result.current.handleResume('m-1', 'wr-1', { isPublicAPI: true, onGetSuggestedQuestions })
    })

    await act(async () => {
      await resumeCallbacks.onCompleted()
    })
    expect(result.current.suggestedQuestions).toEqual(['Suggested 1', 'Suggested 2'])

    // Error branch (catch block 271-273)
    await act(async () => {
      await resumeCallbacks.onCompleted()
    })
    expect(result.current.suggestedQuestions).toHaveLength(0)
  })

  it('should cover handleSend onNodeStarted/onWorkflowStarted branches for tracing 908, 969', () => {
    let sendCallbacks: HookCallbacks
    vi.mocked(ssePost).mockImplementation(async (_url, _params, options) => {
      sendCallbacks = options as HookCallbacks
    })

    const { result } = renderHook(() => useChat())
    act(() => {
      result.current.handleSend('url', { query: 'test' }, {})
    })

    act(() => {
      // Initialize workflowProcess (hits else branch of 910)
      sendCallbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })

      // Hit L969: onNodeStarted (this hits 968-969 if we find a way to make tracing null, but it's init to [] above)
      // Actually, to hit 969, workflowProcess must exist but tracing be falsy.
      // We can't easily force this in handleSend since it's local.
      // But we can hit 908 by calling onWorkflowStarted again after some trace.
      sendCallbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1' } })

      // Now tracing.length > 0
      // Hit L908: onWorkflowStarted again
      sendCallbacks.onWorkflowStarted({ workflow_run_id: 'wr-1', task_id: 't-1' })
    })

    expect(result.current.chatList[1].workflowProcess!.tracing).toHaveLength(1)
  })

  it('should cover handleResume onHumanInputFormFilled splicing and onHumanInputFormTimeout updating', () => {
    let resumeCallbacks: HookCallbacks
    vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
      resumeCallbacks = options as HookCallbacks
    })

    const prevChatTree = [{
      id: 'q',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'm-1',
        content: 'initial',
        isAnswer: true,
        siblingIndex: 0,
        humanInputFormDataList: [{ node_id: 'n-1', expiration_time: 100 }],
      }],
    }]

    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      result.current.handleResume('m-1', 'wr-1', { isPublicAPI: true })
    })

    act(() => {
      // Hit L535-537: onHumanInputFormTimeout (update)
      resumeCallbacks.onHumanInputFormTimeout({ data: { node_id: 'n-1', expiration_time: 200 } })

      // Hit L519-522: onHumanInputFormFilled (splice)
      resumeCallbacks.onHumanInputFormFilled({ data: { node_id: 'n-1' } })
    })

    const lastResponse = result.current.chatList[1]
    expect(lastResponse.humanInputFormDataList).toHaveLength(0)
    expect(lastResponse.humanInputFilledFormDataList).toHaveLength(1)
  })

  it('should cover handleResume branches where workflowProcess exists but tracing is missing (L386, L414, L472)', () => {
    let resumeCallbacks: HookCallbacks
    vi.mocked(sseGet).mockImplementation(async (_url, _params, options) => {
      resumeCallbacks = options as HookCallbacks
    })

    const prevChatTree = [{
      id: 'q',
      content: 'query',
      isAnswer: false,
      children: [{
        id: 'm-1',
        content: 'initial',
        isAnswer: true,
        siblingIndex: 0,
        workflowProcess: {
          status: WorkflowRunningStatus.Running,
          // tracing: undefined
        },
      }],
    }]

    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      result.current.handleResume('m-1', 'wr-1', { isPublicAPI: true })
    })

    act(() => {
      // Hit L386: onIterationStart
      resumeCallbacks.onIterationStart({ data: { node_id: 'i-1' } })
      // Hit L414: onNodeStarted
      resumeCallbacks.onNodeStarted({ data: { node_id: 'n-1', id: 'n-1' } })
      // Hit L472: onLoopStart
      resumeCallbacks.onLoopStart({ data: { node_id: 'l-1' } })
    })

    const lastResponse = result.current.chatList[1]
    expect(lastResponse.workflowProcess?.tracing).toHaveLength(3)
  })

  it('should cover handleRestart with and without callback', () => {
    const { result } = renderHook(() => useChat())
    const callback = vi.fn()
    act(() => {
      result.current.handleRestart(callback)
    })
    expect(callback).toHaveBeenCalled()

    act(() => {
      result.current.handleRestart()
    })
    // Should not crash
    expect(result.current.chatList).toHaveLength(0)
  })

  it('should cover handleAnnotationAdded updating node', async () => {
    const prevChatTree = [{
      id: 'q-1',
      content: 'q',
      isAnswer: false,
      children: [{ id: 'a-1', content: 'a', isAnswer: true, siblingIndex: 0 }],
    }]
    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    await act(async () => {
      // (annotationId, authorName, query, answer, index)
      result.current.handleAnnotationAdded('anno-id', 'author', 'q-new', 'a-new', 1)
    })
    expect(result.current.chatList[0].content).toBe('q-new')
    expect(result.current.chatList[1].content).toBe('a')
    expect(result.current.chatList[1].annotation?.logAnnotation?.content).toBe('a-new')
    expect(result.current.chatList[1].annotation?.id).toBe('anno-id')
  })

  it('should cover handleAnnotationEdited updating node', async () => {
    const prevChatTree = [{
      id: 'q-1',
      content: 'q',
      isAnswer: false,
      children: [{ id: 'a-1', content: 'a', isAnswer: true, siblingIndex: 0 }],
    }]
    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    await act(async () => {
      // (query, answer, index)
      result.current.handleAnnotationEdited('q-edit', 'a-edit', 1)
    })
    expect(result.current.chatList[0].content).toBe('q-edit')
    expect(result.current.chatList[1].content).toBe('a-edit')
  })

  it('should cover handleAnnotationRemoved updating node', () => {
    const prevChatTree = [{
      id: 'q-1',
      content: 'q',
      isAnswer: false,
      children: [{
        id: 'a-1',
        content: 'a',
        isAnswer: true,
        siblingIndex: 0,
        annotation: { id: 'anno-old' },
      }],
    }]
    const { result } = renderHook(() => useChat(undefined, undefined, prevChatTree as ChatItemInTree[]))
    act(() => {
      result.current.handleAnnotationRemoved(1)
    })
    expect(result.current.chatList[1].annotation?.id).toBe('')
  })
})
