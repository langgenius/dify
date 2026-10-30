import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import type { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import type { MessageContentEvent } from '@/features/generative-ui/protocol/types'
import { act } from '@testing-library/react'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
// oxlint-disable-next-line no-restricted-imports -- Capture the replay transport callbacks exercised by this hook integration test.
import { sseGet } from '@/service/base'
import { useChat } from '../../hooks'

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  sseGet: vi.fn(),
}))
// oxlint-disable-next-line typescript/no-deprecated -- Reattached debug streams use the existing SSE transport.
const getStream = vi.mocked(sseGet)

type HandleRun = ReturnType<typeof useWorkflowRun>['handleRun']
type RunCallbacks = NonNullable<Parameters<HandleRun>[1]>
const handleRun = vi.fn<HandleRun>()
const block: OpenUIContentBlock = {
  id: 'ui-1',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: 0,
  source: 'root = Stack([])',
  status: 'streaming',
  sequence: 1,
  form_state: {},
}

describe('Chatflow debug OpenUI streaming', () => {
  let callbacks: RunCallbacks
  const renderChat = (initial?: ChatItemInTree[]) =>
    renderWorkflowCanvasHook(() => useChat({}, undefined, initial), {
      hooksStoreProps: {
        accessControl: fullWorkflowAccessControl,
        fetchInspectVars: vi.fn(async () => undefined),
        handleRun,
      },
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    })
  beforeEach(() => {
    handleRun.mockImplementation((_params, nextCallbacks) => {
      callbacks = nextCallbacks!
    })
    getStream.mockImplementation(async (_url, _options, nextCallbacks) => {
      callbacks = nextCallbacks
    })
  })

  it.each(['send', 'resume'] as const)(
    '%s reconstructs a UI-only response from deltas and preserves it through text replacement',
    (mode) => {
      const initial: ChatItemInTree[] =
        mode === 'resume'
          ? [
              {
                id: 'question-message-1',
                content: 'Revenue',
                isAnswer: false,
                children: [
                  { id: 'message-1', content: '', isAnswer: true, content_blocks: [block] },
                ],
              },
            ]
          : []
      const { result } = renderChat(initial)
      act(() => {
        if (mode === 'resume') result.current.handleResume('message-1', 'workflow-1', {})
        else result.current.handleSend({ query: 'Show revenue' }, {})
      })
      const event: MessageContentEvent = {
        event: 'message_content',
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
        data: block,
      }
      const sourceDelta = '\ncaption = Text("Revenue")'
      const deltaEvent: MessageContentEvent = {
        ...event,
        data: {
          type: 'openui_delta',
          id: block.id,
          base_sequence: block.sequence,
          sequence: 2,
          source_delta: sourceDelta,
        },
      }
      act(() => {
        callbacks.onMessageContent?.(event)
        callbacks.onMessageContent?.(deltaEvent)
        callbacks.onMessageContent?.(deltaEvent)
      })
      expect(result.current.chatList[1]?.content_blocks).toEqual([
        { ...block, source: block.source + sourceDelta, sequence: 2 },
      ])
      act(() => {
        callbacks.onMessageContent?.({
          ...event,
          data: { ...block, source: block.source + sourceDelta, status: 'completed', sequence: 3 },
        })
        callbacks.onMessageContent?.(event)
        callbacks.onMessageReplace?.({
          task_id: 'task-1',
          id: 'message-1',
          answer: 'Updated summary',
          conversation_id: 'conversation-1',
        })
      })

      expect(result.current.chatList[1]).toMatchObject({
        id: 'message-1',
        content: 'Updated summary',
        content_blocks: [
          { ...block, source: block.source + sourceDelta, status: 'completed', sequence: 3 },
        ],
      })
    },
  )

  it.each([
    { mode: 'send', reason: 'agent_final', preservesUI: true },
    { mode: 'send', reason: 'output_moderation', preservesUI: false },
    { mode: 'resume', reason: 'agent_final', preservesUI: true },
    { mode: 'resume', reason: 'output_moderation', preservesUI: false },
  ])('$mode preserves UI=$preservesUI for $reason replacement', ({ mode, reason, preservesUI }) => {
    const initial: ChatItemInTree[] =
      mode === 'resume'
        ? [
            {
              id: 'question-message-1',
              content: 'Revenue',
              isAnswer: false,
              children: [{ id: 'message-1', content: '', isAnswer: true, content_blocks: [block] }],
            },
          ]
        : []
    const { result } = renderChat(initial)
    act(() => {
      if (mode === 'resume') result.current.handleResume('message-1', 'workflow-1', {})
      else result.current.handleSend({ query: 'Show revenue' }, {})
    })
    act(() => {
      callbacks.onMessageContent?.({
        event: 'message_content',
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
        data: block,
      })
      callbacks.onMessageReplace?.({
        id: 'message-1',
        task_id: 'task-1',
        conversation_id: 'conversation-1',
        answer: 'Replacement answer',
        reason,
      })
    })
    expect(result.current.chatList[1]?.content).toBe('Replacement answer')
    expect(result.current.chatList[1]?.content_blocks).toEqual(preservesUI ? [block] : [])
  })

  it('cancels partial UI content when stopping the debug stream', () => {
    const { result } = renderChat()
    act(() => {
      result.current.handleSend({ query: 'Show revenue' }, {})
    })
    act(() =>
      callbacks.onMessageContent?.({
        event: 'message_content',
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
        data: block,
      }),
    )
    act(() => result.current.handleStop())
    act(() => callbacks.onError?.('Aborted'))

    expect(result.current.chatList[1]?.content_blocks?.[0]?.status).toBe('cancelled')
    expect(result.current.isResponding).toBe(false)
  })

  it('does not restore a cleared conversation when a form state save finishes', () => {
    const completedBlock: OpenUIContentBlock = { ...block, status: 'completed' }
    const { result } = renderChat([
      {
        id: 'question-message-1',
        content: 'Revenue',
        isAnswer: false,
        children: [
          { id: 'message-1', content: '', isAnswer: true, content_blocks: [completedBlock] },
        ],
      },
    ])

    act(() => result.current.handleRestart())
    expect(result.current.chatList).toEqual([])
    act(() =>
      result.current.handleContentBlockStateSaved('message-1', {
        ...completedBlock,
        form_state: { region: 'East' },
      }),
    )

    expect(result.current.chatList).toEqual([])
  })

  it.each([
    { mode: 'send', terminalEvent: 'completed' },
    { mode: 'send', terminalEvent: 'error' },
    { mode: 'resume', terminalEvent: 'completed' },
    { mode: 'resume', terminalEvent: 'error' },
  ] as const)(
    'ignores old $mode UI and $terminalEvent callbacks after restarting the conversation',
    async ({ mode, terminalEvent }) => {
      const { result } = renderChat(
        mode === 'resume'
          ? [
              {
                id: 'question-message-1',
                content: 'Revenue',
                isAnswer: false,
                children: [
                  { id: 'message-1', content: '', isAnswer: true, content_blocks: [block] },
                ],
              },
            ]
          : undefined,
      )
      act(() => {
        if (mode === 'resume') result.current.handleResume('message-1', 'workflow-1', {})
        else result.current.handleSend({ query: 'Show revenue' }, {})
      })
      const previousCallbacks = callbacks
      act(() => result.current.handleRestart())
      act(() => result.current.handleSend({ query: 'Start another conversation' }, {}))

      await act(async () => {
        previousCallbacks.onMessageContent?.({
          event: 'message_content',
          message_id: 'message-1',
          conversation_id: 'conversation-1',
          task_id: 'task-1',
          data: block,
        })
        if (terminalEvent === 'completed') await previousCallbacks.onCompleted?.(false)
        else previousCallbacks.onError?.('Aborted')
      })

      expect(result.current.chatList).toHaveLength(2)
      expect(result.current.chatList[0]?.content).toBe('Start another conversation')
      expect(result.current.chatList[1]?.content_blocks).toBeUndefined()
      expect(result.current.conversationId).toBe('')
      expect(result.current.isResponding).toBe(true)
    },
  )
})
