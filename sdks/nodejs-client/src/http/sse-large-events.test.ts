import { Readable } from 'node:stream'
import { describe, expect, it } from 'vite-plus/test'
import { parseSseStream } from './sse'

describe('fragmented SSE events', () => {
  it('preserves a large JSON event split across thousands of small chunks', async () => {
    const payload = { event: 'node_finished', data: { output: 'a'.repeat(1024 * 1024) } }
    const wire = Buffer.from(`data: ${JSON.stringify(payload)}\r\n\r\n`)
    // objectMode keeps each network fragment separate for the parser.
    const chunks = function* () {
      for (let offset = 0; offset < wire.length; offset += 256) {
        yield wire.subarray(offset, offset + 256)
      }
    }
    const events = []
    for await (const event of parseSseStream(Readable.from(chunks()))) events.push(event.data)
    expect(events).toEqual([payload])
  })

  it('joins Unicode fragments while preserving all supported line boundaries', async () => {
    const text = '\uFEFFevent: message\rdata: {"answer":"你好🙂"}\r\n\r\ndata: tail\n\n'
    const bytes = Buffer.from(text)
    const stream = Readable.from(Array.from(bytes, byte => Buffer.from([byte])))
    const events = []
    for await (const event of parseSseStream(stream)) events.push([event.event, event.data])
    expect(events).toEqual([['message', { answer: '你好🙂' }], [undefined, 'tail']])
  })
})
