import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it } from 'vite-plus/test'
import { createBinaryStream, createSseStream, parseSseStream } from './sse'

describe('sse parsing', () => {
  it.each(['\n', '\r\n', '\r'])(
    'ignores one leading UTF-8 BOM with %j line endings across byte boundaries',
    async (ending) => {
      const body = Buffer.from(`\uFEFFdata: {"answer":"你好"}${ending}${ending}`)
      const chunks = [Buffer.alloc(0), ...Array.from(body, (byte) => Buffer.from([byte]))]
      const events = []
      for await (const event of parseSseStream(Readable.from(chunks))) {
        events.push(event)
      }
      expect(events).toEqual([
        { event: undefined, data: { answer: '你好' }, raw: '{"answer":"你好"}' },
      ])
    },
  )

  it('preserves BOM characters in payloads and does not strip later field prefixes', async () => {
    const body = 'data: {"answer":"\uFEFFkept"}\n\n\uFEFFdata: {"answer":"ignored"}\n\n'
    const stream = createSseStream(Readable.from([body]), { status: 200, headers: {} })
    expect(await stream.toText()).toBe('\uFEFFkept')
  })

  it.each(['\n', '\r\n', '\r'])(
    'parses events with %j line endings across byte boundaries',
    async (ending) => {
      const body = Buffer.from(
        [
          ': keep-alive',
          'event: message',
          'data: {"answer":"你好"}',
          '',
          'data: {"delta":" world"}',
          '',
          '',
        ].join(ending),
      )
      const chunks = Array.from(body, (byte) => Buffer.from([byte]))
      const events = []
      for await (const event of parseSseStream(Readable.from(chunks))) {
        events.push(event)
      }
      expect(events).toEqual([
        { event: 'message', data: { answer: '你好' }, raw: '{"answer":"你好"}' },
        { event: undefined, data: { delta: ' world' }, raw: '{"delta":" world"}' },
      ])
    },
  )

  it('emits a CR-delimited event before the stream closes', async () => {
    const stream = new PassThrough()
    const iterator = parseSseStream(stream)[Symbol.asyncIterator]()
    try {
      const next = iterator.next()
      stream.write('data: first\r\r')
      expect(await next).toEqual({
        done: false,
        value: { event: undefined, data: 'first', raw: 'first' },
      })
    } finally {
      stream.end()
      await iterator.return?.()
    }
  })

  it('toText accepts mixed SSE line endings', async () => {
    const stream = Readable.from([
      'event: message\rdata: {"answer":"Hello"}\r\r',
      'data: {"delta":" world"}\r\n\r\n',
      'data: {"delta":"!"}\n\n',
    ])
    expect(await createSseStream(stream, { status: 200, headers: {} }).toText()).toBe(
      'Hello world!',
    )
  })

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
