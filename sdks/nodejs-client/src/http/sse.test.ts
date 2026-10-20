import { Readable } from 'node:stream'
import { describe, expect, it } from 'vite-plus/test'
import { APIError } from '../errors/dify-error'
import { createBinaryStream, createSseStream, parseSseStream } from './sse'

describe('sse parsing', () => {
  it.each([
    ['data:  indented', ' indented'],
    ['data:\tindented', '\tindented'],
    ['data: \tindented', '\tindented'],
    ['data:\u00A0indented', '\u00A0indented'],
    ['data:plain', 'plain'],
    ['data: plain', 'plain'],
  ])('preserves payload whitespace in %s', async (line, expected) => {
    const events = []
    for await (const event of parseSseStream(Readable.from([`${line}\n\n`]))) {
      events.push(event)
    }
    expect(events).toEqual([{ event: undefined, data: expected, raw: expected }])
  })

  it('keeps meaningful whitespace in event names', async () => {
    const events = []
    for await (const event of parseSseStream(Readable.from(['event:  custom \ndata: text\n\n']))) {
      events.push(event)
    }
    expect(events[0]?.event).toBe(' custom ')
  })

  it('toText preserves multi-line indentation', async () => {
    const stream = Readable.from(['data:   first\ndata: \tsecond\n\n'])
    expect(await createSseStream(stream, { status: 200, headers: {} }).toText()).toBe(
      '  first\n\tsecond',
    )
  })

  it('parses event and data lines', async () => {
    const stream = Readable.from(['event: message\n', 'data: {"answer":"hi"}\n', '\n'])
    const events: Array<{ event?: string; data: unknown; raw: string }> = []
    for await (const event of parseSseStream(stream)) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0]!.event).toBe('message')
    expect(events[0]!.data).toEqual({ answer: 'hi' })
  })

  it('handles multi-line data payloads', async () => {
    const stream = Readable.from(['data: line1\n', 'data: line2\n', '\n'])
    const events: Array<{ event?: string; data: unknown; raw: string }> = []
    for await (const event of parseSseStream(stream)) {
      events.push(event)
    }
    expect(events[0]!.raw).toBe('line1\nline2')
    expect(events[0]!.data).toBe('line1\nline2')
  })

  it('ignores comments and flushes the last event without a trailing separator', async () => {
    const stream = Readable.from([
      Buffer.from(': keep-alive\n'),
      Uint8Array.from(Buffer.from('event: message\ndata: {"delta":"hi"}\n')),
    ])
    const events: Array<{ event?: string; data: unknown; raw: string }> = []
    for await (const event of parseSseStream(stream)) {
      events.push(event)
    }
    expect(events).toEqual([
      {
        event: 'message',
        data: { delta: 'hi' },
        raw: '{"delta":"hi"}',
      },
    ])
  })

  it('createSseStream exposes toText', async () => {
    const stream = Readable.from(['data: {"answer":"hello"}\n\n', 'data: {"delta":" world"}\n\n'])
    const sseStream = createSseStream(stream, {
      status: 200,
      headers: {},
      requestId: 'req',
    })
    const text = await sseStream.toText()
    expect(text).toBe('hello world')
  })

  it.each([
    '',
    'data: {"event":"message","answer":"partial answer"}\n\n',
    [
      'data: {"event":"text_chunk","data":{"text":"partial answer"}}\n\n',
      'data: {"event":"message_replace","answer":"replacement"}\n\n',
    ].join(''),
  ])('toText rejects a streamed API error after %j', async (prefix) => {
    const error = {
      event: 'error',
      status: 429,
      code: 'rate_limit_error',
      message: 'Rate limit reached',
    }
    const stream = Readable.from([prefix, `data: ${JSON.stringify(error)}\n\n`])
    const sseStream = createSseStream(stream, {
      status: 200,
      headers: {},
      requestId: 'req-stream',
    })

    const result = sseStream.toText()
    await expect(result).rejects.toBeInstanceOf(APIError)
    await expect(result).rejects.toMatchObject({
      message: error.message,
      statusCode: error.status,
      responseBody: error,
      requestId: 'req-stream',
    })
  })

  it('keeps streamed API errors available to event consumers', async () => {
    const error = { event: 'error', status: 400, code: 'invalid_param', message: 'Invalid input' }
    const stream = createSseStream(Readable.from([`data: ${JSON.stringify(error)}\n\n`]), {
      status: 200,
      headers: {},
    })
    const events = []
    for await (const event of stream) {
      events.push(event.data)
    }

    expect(events).toEqual([error])
  })

  it('rejects malformed error metadata without collecting its text', async () => {
    const error = { event: 'error', message: null, status: '429', answer: 'not a success' }
    const stream = createSseStream(Readable.from([`data: ${JSON.stringify(error)}\n\n`]), {
      status: 200,
      headers: {},
    })

    await expect(stream.toText()).rejects.toMatchObject({
      name: 'APIError',
      message: 'Stream returned an error',
      statusCode: undefined,
      responseBody: error,
      requestId: undefined,
    })
  })

  it('toText extracts text from string data', async () => {
    const stream = Readable.from(['data: plain text\n\n'])
    const sseStream = createSseStream(stream, { status: 200, headers: {} })
    const text = await sseStream.toText()
    expect(text).toBe('plain text')
  })

  it('toText extracts text field from object', async () => {
    const stream = Readable.from(['data: {"text":"hello"}\n\n'])
    const sseStream = createSseStream(stream, { status: 200, headers: {} })
    const text = await sseStream.toText()
    expect(text).toBe('hello')
  })

  it('toText collects text_chunk events from workflow streams', async () => {
    const stream = Readable.from([
      'data: {"event":"workflow_started","data":{"id":"run"}}\n\n',
      'data: {"event":"text_chunk","data":{"text":"Hello","from_variable_selector":["llm","text"]}}\n\n',
      'data: {"event":"reasoning_chunk","data":{"text":"thinking"}}\n\n',
      'data: {"event":"text_chunk","data":{"text":" world"}}\n\n',
      'data: {"event":"workflow_finished","data":{"outputs":{"text":"Hello world"}}}\n\n',
    ])
    const text = await createSseStream(stream, { status: 200, headers: {} }).toText()
    expect(text).toBe('Hello world')
  })

  it('toText replaces streamed text on message_replace', async () => {
    const stream = Readable.from([
      'data: {"event":"message","answer":"unsafe "}\n\n',
      'data: {"event":"message","answer":"output"}\n\n',
      'data: {"event":"message_replace","answer":"Sorry, I cannot answer that.","reason":"output_moderation"}\n\n',
      'data: {"event":"message_end","id":"msg"}\n\n',
    ])
    const text = await createSseStream(stream, { status: 200, headers: {} }).toText()
    expect(text).toBe('Sorry, I cannot answer that.')
  })

  it('toText returns empty for invalid data', async () => {
    const stream = Readable.from(['data: null\n\n', 'data: 123\n\n'])
    const sseStream = createSseStream(stream, { status: 200, headers: {} })
    const text = await sseStream.toText()
    expect(text).toBe('')
  })

  it('createBinaryStream exposes metadata', () => {
    const stream = Readable.from(['chunk'])
    const binary = createBinaryStream(stream, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      requestId: 'req',
    })
    expect(binary.status).toBe(200)
    expect(binary.headers['content-type']).toBe('audio/mpeg')
    expect(binary.toReadable()).toBe(stream)
  })
})
