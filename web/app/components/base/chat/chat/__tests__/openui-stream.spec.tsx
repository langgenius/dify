import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItemInTree } from '../../types'
import type { MessageContentEvent } from '@/features/generative-ui/protocol/types'
// oxlint-disable-next-line no-restricted-imports -- These tests exercise the existing SSE callback contract.
import type { IOtherOptions } from '@/service/base'
import { act } from '@testing-library/react'
// oxlint-disable-next-line no-restricted-imports -- Mock the shared SSE transport used by both chat runtimes.
import { sseGet, ssePost } from '@/service/base'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useChat } from '../hooks'

vi.mock('@/service/base', () => ({ sseGet: vi.fn(), ssePost: vi.fn() }))
vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '',
}))
vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: { getInstance: vi.fn() },
}))

// oxlint-disable-next-line typescript/no-deprecated -- Test the shared SSE transport that owns message_content dispatch.
const postStream = vi.mocked(ssePost)
// oxlint-disable-next-line typescript/no-deprecated -- Reattachment uses the shared GET SSE transport.
const getStream = vi.mocked(sseGet)

const block: OpenUIContentBlock = {
  id: 'ui-1',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: 0,
  source: 'root = Text("Revenue")',
  status: 'streaming',
  sequence: 1,
  form_state: {},
}
const event = (data: MessageContentEvent['data']): MessageContentEvent => ({
  event: 'message_content',
  message_id: 'message-1',
  conversation_id: 'conversation-1',
  task_id: 'task-1',
  data,
})

describe('shared OpenUI chat streaming', () => {
  let callbacks: IOtherOptions

  beforeEach(() => {
    vi.clearAllMocks()
    postStream.mockImplementation(async (_url, _options, nextCallbacks) => {
      callbacks = nextCallbacks
    })
    getStream.mockImplementation(async (_url, _options, nextCallbacks) => {
      callbacks = nextCallbacks
    })
  })

  it.each([false, true])(
    'keeps UI source separate from text in Agent V2 mode %s',
    async (isNewAgent) => {
      const { result } = renderHookWithConsoleQuery(() =>
        useChat(undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
          isNewAgent,
        }),
      )
      await act(async () => {
        await result.current.handleSend('/chat-messages', { query: 'Show revenue' }, {})
      })
      act(() => callbacks.onMessageContent?.(event(block)))
      const delta: MessageContentEvent['data'] = {
        type: 'openui_delta',
        id: block.id,
        base_sequence: block.sequence,
        sequence: 2,
        source_delta: '\ncaption = Text("Quarterly sales")',
      }
      act(() => callbacks.onMessageContent?.(event(delta)))
      expect(result.current.chatList[1]?.content_blocks).toEqual([
        { ...block, source: block.source + delta.source_delta, sequence: 2 },
      ])
      const completed: OpenUIContentBlock = {
        ...block,
        source: block.source + delta.source_delta,
        status: 'completed',
        sequence: 3,
      }
      act(() => {
        callbacks.onMessageContent?.(event(delta))
        callbacks.onMessageContent?.(event(completed))
        callbacks.onMessageContent?.(event(block))
      })

      expect(result.current.chatList[1]).toMatchObject({
        id: 'message-1',
        content: '',
        content_blocks: [completed],
      })
      expect(result.current.chatList[1]?.agent_response_parts).toBeUndefined()
      await act(async () => callbacks.onCompleted?.())
      await act(async () => {
        await result.current.handleSend(
          '/chat-messages',
          { query: 'Show last month', parent_message_id: 'message-1' },
          {},
        )
      })
      expect(postStream.mock.calls.at(-1)?.[1].body).toMatchObject({
        conversation_id: 'conversation-1',
        parent_message_id: 'message-1',
      })
    },
  )

  it.each([
    { mode: 'send', reason: 'agent_final', preservesUI: true },
    { mode: 'send', reason: 'output_moderation', preservesUI: false },
    { mode: 'resume', reason: 'agent_final', preservesUI: true },
    { mode: 'resume', reason: 'output_moderation', preservesUI: false },
  ])(
    '$mode replaces text and preserves UI=$preservesUI for $reason',
    async ({ mode, reason, preservesUI }) => {
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
      const { result } = renderHookWithConsoleQuery(() => useChat(undefined, undefined, initial))
      await act(async () => {
        if (mode === 'resume') result.current.handleResume('message-1', 'workflow-1', {})
        else await result.current.handleSend('/chat-messages', { query: 'Revenue' }, {})
      })
      act(() => {
        callbacks.onMessageContent?.(event(block))
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
    },
  )

  it('reconciles completed UI with authoritative message history', async () => {
    const completed: OpenUIContentBlock = {
      ...block,
      source: 'root = Text("Final revenue")',
      status: 'completed',
      sequence: 2,
    }
    const { result } = renderHookWithConsoleQuery(() => useChat())
    await act(async () => {
      await result.current.handleSend(
        '/chat-messages',
        { query: 'Revenue' },
        {
          onGetConversationMessages: async () => ({
            data: [{ id: 'message-1', answer: 'Revenue summary', content_blocks: [completed] }],
          }),
        },
      )
    })
    act(() => callbacks.onMessageContent?.(event(block)))
    await act(async () => callbacks.onCompleted?.())

    expect(result.current.chatList[1]).toMatchObject({
      content: 'Revenue summary',
      content_blocks: [completed],
    })
  })

  it('marks a partial UI as cancelled when the user stops generation', async () => {
    const { result } = renderHookWithConsoleQuery(() => useChat())
    await act(async () => {
      await result.current.handleSend('/chat-messages', { query: 'Revenue' }, {})
    })
    act(() => callbacks.onMessageContent?.(event(block)))
    await act(async () => result.current.handleStop())

    expect(result.current.chatList[1]?.content_blocks?.[0]?.status).toBe('cancelled')
    expect(result.current.isResponding).toBe(false)
  })

  it('updates the same independent content block when an existing message stream is reattached', () => {
    const initial: ChatItemInTree[] = [
      {
        id: 'question-message-1',
        content: 'Revenue',
        isAnswer: false,
        children: [{ id: 'message-1', content: '', isAnswer: true, content_blocks: [block] }],
      },
    ]
    const { result } = renderHookWithConsoleQuery(() => useChat(undefined, undefined, initial))
    act(() => {
      result.current.handleResume('message-1', 'workflow-1', {})
    })
    const sourceDelta = '\ncaption = Text("Restored sales")'
    const completed: OpenUIContentBlock = {
      ...block,
      source: block.source + sourceDelta,
      status: 'completed',
      sequence: 3,
    }
    act(() => {
      callbacks.onMessageContent?.(
        event({
          type: 'openui_delta',
          id: block.id,
          base_sequence: block.sequence,
          sequence: 2,
          source_delta: sourceDelta,
        }),
      )
    })
    expect(result.current.chatList[1]?.content_blocks?.[0]?.source).toBe(completed.source)
    act(() => {
      callbacks.onMessageContent?.(event(completed))
      callbacks.onMessageContent?.(event(block))
    })
    expect(result.current.chatList[1]?.content_blocks).toEqual([completed])
    expect(result.current.chatList[1]?.humanInputFormDataList).toBeUndefined()
  })
})
