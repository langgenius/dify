import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { consumeServiceApiSse } from '../features/agent-v2/support/service-api-sse'

const encodeChunks = (text: string, splitPoints: number[]) => {
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let start = 0

  for (const end of splitPoints) {
    chunks.push(bytes.slice(start, end))
    start = end
  }

  chunks.push(bytes.slice(start))
  return chunks
}

const streamFromChunks = (chunks: Uint8Array<ArrayBuffer>[]) =>
  new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

describe('consumeServiceApiSse', () => {
  it('parses UTF-8 events split across byte chunks and multiline data fields', async () => {
    const stream = [
      'data: {"event":"message","answer":"测试"}\n\n',
      'event: message_end\n',
      'data: {\n',
      'data:   "event": "message_end",\n',
      'data:   "conversation_id": "conversation-1"\n',
      'data: }\n\n',
    ].join('')
    const result = await consumeServiceApiSse(
      streamFromChunks(encodeChunks(stream, [1, 7, 31, 43, 58])),
    )

    assert.equal(result.answer, '测试')
    assert.equal(result.events.length, 2)
    assert.deepEqual(result.events[1], {
      data: {
        conversation_id: 'conversation-1',
        event: 'message_end',
      },
      event: 'message_end',
    })
  })

  it('reports SSE error details immediately', async () => {
    const stream = streamFromChunks(
      encodeChunks(
        'data: {"event":"error","code":"internal_server_error","message":"workspace failed","conversation_id":"conversation-1","message_id":"message-1"}\n\n',
        [13, 37, 81],
      ),
    )

    await assert.rejects(consumeServiceApiSse(stream), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /internal_server_error/)
      assert.match(error.message, /workspace failed/)
      assert.match(error.message, /conversation-1/)
      assert.match(error.message, /message-1/)
      return true
    })
  })

  it('rejects invalid JSON event data', async () => {
    const stream = streamFromChunks(encodeChunks('data: {not-json}\n\n', []))

    await assert.rejects(consumeServiceApiSse(stream), /invalid JSON/i)
  })

  it('rejects a stream that closes before a terminal event', async () => {
    const stream = streamFromChunks(
      encodeChunks('data: {"event":"message","answer":"partial"}\n\n', []),
    )

    await assert.rejects(consumeServiceApiSse(stream), /closed before a terminal event.*message/s)
  })

  it('rejects a response without a readable body', async () => {
    await assert.rejects(consumeServiceApiSse(null), /readable body/i)
  })

  it('bounds incomplete event buffering', async () => {
    const oversizedEvent = `data: ${'x'.repeat(1_048_577)}`
    const stream = streamFromChunks(encodeChunks(oversizedEvent, [512_000]))

    await assert.rejects(consumeServiceApiSse(stream), /buffer/i)
  })
})
