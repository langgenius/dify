import type { MessageContentEvent } from '@/features/generative-ui/protocol/types'
// oxlint-disable-next-line no-restricted-imports -- The shared SSE transport owns dispatch of the new content event.
import { sseGet, ssePost } from '../base'

describe('OpenUI SSE transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  // oxlint-disable-next-line typescript/no-deprecated -- Assert both existing transport entry points dispatch the new SSE event.
  it.each([ssePost, sseGet])(
    'dispatches UI snapshots and deltas independently of answer text',
    async (stream) => {
      const contentEvent: MessageContentEvent = {
        event: 'message_content',
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
        data: {
          id: 'ui-1',
          type: 'openui',
          library_version: 'dify-ui-v1',
          text_offset: 0,
          sequence: 1,
          source: 'root = Stack([])',
          status: 'streaming',
          form_state: {},
        },
      }
      const textEvent = {
        event: 'message',
        answer: 'Summary',
        id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
      }
      const deltaEvent: MessageContentEvent = {
        ...contentEvent,
        data: {
          type: 'openui_delta',
          id: contentEvent.data.id,
          sequence: 2,
          base_sequence: 1,
          source_delta: '\ncaption = Text("Revenue")',
        },
      }
      const events = [contentEvent, textEvent, deltaEvent]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(events, {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )
      const onMessageContent = vi.fn()
      const onData = vi.fn()
      const onCompleted = vi.fn()

      await stream('/chat-messages', {}, { onMessageContent, onData, onCompleted })
      await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())

      expect(onMessageContent).toHaveBeenCalledTimes(2)
      expect(onMessageContent).toHaveBeenNthCalledWith(1, contentEvent)
      expect(onMessageContent).toHaveBeenNthCalledWith(2, deltaEvent)
      expect(onData).toHaveBeenCalledExactlyOnceWith(
        'Summary',
        true,
        expect.objectContaining({ messageId: 'message-1' }),
      )
    },
  )

  it.each([
    { event: 'message', bytewise: false },
    { event: 'message', bytewise: true },
    { event: 'agent_message', bytewise: false },
    { event: 'agent_message', bytewise: true },
  ])(
    'preserves UI text offsets for $event with bytewise transport=$bytewise',
    async ({ event, bytewise }) => {
      const beforeChunks = ['Before \\u0041. \\u0', '042 中文 \u{1F4CA}.\n\n']
      const before = beforeChunks.join('')
      const after = 'After the UI.'
      const textEvent = (answer: string) => ({
        event,
        answer,
        id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
      })
      const contentEvent = {
        event: 'message_content',
        message_id: 'message-1',
        conversation_id: 'conversation-1',
        task_id: 'task-1',
        data: {
          id: 'ui-1',
          type: 'openui',
          library_version: 'dify-ui-v1',
          text_offset: Array.from(before).length,
          sequence: 1,
          source: 'root = Stack([Text("Result")])',
          status: 'completed',
          form_state: {},
        },
      } satisfies MessageContentEvent
      const bytes = new TextEncoder().encode(
        [...beforeChunks.map(textEvent), contentEvent, textEvent(after)]
          .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
          .join(''),
      )
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (bytewise) {
            for (let index = 0; index < bytes.length; index++)
              controller.enqueue(bytes.subarray(index, index + 1))
          } else {
            controller.enqueue(bytes)
          }
          controller.close()
        },
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
      const onData = vi.fn<(text: string) => void>()
      const onMessageContent = vi.fn()
      const onCompleted = vi.fn()

      // oxlint-disable-next-line typescript/no-deprecated -- Verify text and UI offsets across the shared SSE transport.
      await ssePost('/chat-messages', {}, { onData, onMessageContent, onCompleted })
      await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled())

      expect(onData.mock.calls.map(([text]) => text)).toEqual([...beforeChunks, after])
      expect(onMessageContent).toHaveBeenCalledExactlyOnceWith(contentEvent)
      const receivedText = Array.from(onData.mock.calls.map(([text]) => text).join(''))
      expect(receivedText.slice(0, contentEvent.data.text_offset).join('')).toBe(before)
      expect(receivedText.slice(contentEvent.data.text_offset).join('')).toBe(after)
    },
  )
})
