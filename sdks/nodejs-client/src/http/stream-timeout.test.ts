import { getEventListeners, once } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TimeoutError } from '../errors/dify-error'
import { HttpClient } from './client'

type Mode = 'sse' | 'binary'

const openResponse = () => {
  let controller: ReadableStreamDefaultController<Uint8Array>
  let signal: AbortSignal
  const abort = () => controller.error(signal.reason)
  const cancel = vi.fn(() => signal.removeEventListener('abort', abort))
  const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
    signal = init.signal!
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value
            signal.addEventListener('abort', abort, { once: true })
          },
          cancel,
        }),
        { headers: { 'x-request-id': 'stream-request' } },
      ),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    cancel,
    get signal() {
      return signal
    },
    write(text: string) {
      controller.enqueue(new TextEncoder().encode(text))
    },
    end() {
      signal.removeEventListener('abort', abort)
      controller.close()
    },
    fail(error: Error) {
      signal.removeEventListener('abort', abort)
      controller.error(error)
    },
  }
}

const request = async (mode: Mode) => {
  const client = new HttpClient({ apiKey: 'test', timeout: 0.1, maxRetries: 2 })
  const options = { method: 'POST' as const, path: '/stream', data: { user: 'test' } }
  if (mode === 'sse') {
    const stream = await client.requestStream(options)
    return { data: stream.data, consume: () => stream.toText() }
  }
  const stream = await client.requestBinaryStream(options)
  return {
    data: stream.data,
    consume: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of stream.data) {
        chunks.push(Buffer.from(chunk as Uint8Array))
      }
      return Buffer.concat(chunks).toString('utf8')
    },
  }
}

const encode = (mode: Mode, text: string) =>
  mode === 'sse' ? `data: ${JSON.stringify({ answer: text })}\n\n` : text

describe.each<Mode>(['sse', 'binary'])('%s response timeout', (mode) => {
  const streams: Array<Awaited<ReturnType<typeof request>>['data']> = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(async () => {
    for (const stream of streams.splice(0)) {
      stream.destroy()
    }
    await setImmediate()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const open = async () => {
    const response = openResponse()
    const stream = await request(mode)
    streams.push(stream.data)
    return { response, ...stream }
  }

  it('rejects stalled consumption with TimeoutError without retrying the request', async () => {
    const { response, data, consume } = await open()
    const result = consume().catch((error: unknown) => error)
    response.write(encode(mode, 'partial'))
    await setImmediate()

    await vi.advanceTimersByTimeAsync(100)
    await setImmediate()

    expect(data.errored).toBeInstanceOf(TimeoutError)
    expect(await result).toBeInstanceOf(TimeoutError)
    expect(response.signal.aborted).toBe(true)
    expect(response.fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies the deadline even before a consumer starts reading', async () => {
    const { response, data, consume } = await open()
    // An error must remain observable when a consumer attaches after the deadline.
    await vi.advanceTimersByTimeAsync(100)
    await setImmediate()

    expect(data.errored).toBeInstanceOf(TimeoutError)
    await expect(consume()).rejects.toBeInstanceOf(TimeoutError)
    expect(response.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps one response-lifetime deadline while data continues arriving', async () => {
    const { response, data, consume } = await open()
    const result = consume().catch((error: unknown) => error)
    response.write(encode(mode, 'first'))
    await setImmediate()
    await vi.advanceTimersByTimeAsync(60)
    response.write(encode(mode, 'second'))
    await setImmediate()
    await vi.advanceTimersByTimeAsync(40)
    await setImmediate()

    expect(data.errored).toBeInstanceOf(TimeoutError)
    expect(await result).toBeInstanceOf(TimeoutError)
    expect(response.signal.aborted).toBe(true)
  })

  it('delivers completed content and releases the timer and abort listeners', async () => {
    const { response, consume } = await open()
    const result = consume()
    response.write(encode(mode, 'hello'))
    response.write(encode(mode, ' world'))
    response.end()

    await expect(result).resolves.toBe('hello world')
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(response.signal, 'abort')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(response.signal.aborted).toBe(false)
  })

  it('preserves body errors and releases the timer on failure', async () => {
    const { response, consume } = await open()
    const failure = new Error('response connection reset')
    const result = consume().catch((error: unknown) => error)
    response.fail(failure)

    expect(await result).toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(response.signal, 'abort')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(response.signal.aborted).toBe(false)
  })

  it('keeps a body failure observable before consumption starts', async () => {
    const { response, data, consume } = await open()
    const failure = new Error('response failed before reading')
    response.fail(failure)
    await setImmediate()

    expect(data.errored).toBe(failure)
    await expect(consume()).rejects.toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(response.signal, 'abort')).toHaveLength(0)
  })

  it('preserves content across backpressure and multiple transport chunks', async () => {
    const { response, consume } = await open()
    const text = '你好 🌏 '.repeat(20000)
    const result = consume()
    response.write(encode(mode, text))
    response.write(encode(mode, text))
    response.end()

    await expect(result).resolves.toBe(text + text)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an unconsumed body when the returned stream is destroyed', async () => {
    const { response, data } = await open()
    const closed = once(data, 'close')
    data.destroy()
    await closed
    await setImmediate()

    expect(response.cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(response.signal, 'abort')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(response.signal.aborted).toBe(false)
  })

  it('cancels the body and clears the deadline when iteration ends early', async () => {
    const { response, data } = await open()
    const iterator = data[Symbol.asyncIterator]()
    response.write(encode(mode, 'first'))
    expect((await iterator.next()).done).toBe(false)
    await iterator.return?.()
    await setImmediate()

    expect(response.cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(response.signal, 'abort')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(response.signal.aborted).toBe(false)
  })
})
