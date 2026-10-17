import type { Readable } from 'node:stream'
import type { BinaryStream, DifyStream, Headers, JsonValue, StreamEvent } from '../types/common'
import { StringDecoder } from 'node:string_decoder'
import { isRecord } from '../internal/type-guards'

const toBufferChunk = (chunk: unknown): Buffer => {
  if (Buffer.isBuffer(chunk)) {
    return chunk
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk)
  }
  return Buffer.from(String(chunk))
}

const readLines = async function* (stream: Readable): AsyncIterable<string> {
  const decoder = new StringDecoder('utf8')
  let buffered = ''
  let skipLeadingLf = false
  for await (const chunk of stream) {
    let decoded = decoder.write(toBufferChunk(chunk))
    if (skipLeadingLf && decoded.length > 0) {
      if (decoded.startsWith('\n')) {
        decoded = decoded.slice(1)
      }
      skipLeadingLf = false
    }
    buffered += decoded
    let index = buffered.search(/[\r\n]/)
    while (index >= 0) {
      const line = buffered.slice(0, index)
      const carriageReturn = buffered[index] === '\r'
      buffered = buffered.slice(index + 1)
      if (carriageReturn) {
        if (buffered.startsWith('\n')) {
          buffered = buffered.slice(1)
        } else if (buffered.length === 0) {
          // A CRLF pair may be split between transport chunks.
          skipLeadingLf = true
        }
      }
      yield line
      index = buffered.search(/[\r\n]/)
    }
  }
  buffered += decoder.end()
  if (buffered) {
    yield buffered
  }
}

const parseMaybeJson = (value: string): JsonValue | string | null => {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

export const parseSseStream = async function* <T>(stream: Readable): AsyncIterable<StreamEvent<T>> {
  let eventName: string | undefined
  const dataLines: string[] = []

  const emitEvent = function* (): Iterable<StreamEvent<T>> {
    if (!eventName && dataLines.length === 0) {
      return
    }
    const raw = dataLines.join('\n')
    const parsed = parseMaybeJson(raw) as T | string | null
    yield {
      event: eventName,
      data: parsed,
      raw,
    }
    eventName = undefined
    dataLines.length = 0
  }

  for await (const line of readLines(stream)) {
    if (!line) {
      yield* emitEvent()
      continue
    }
    if (line.startsWith(':')) {
      continue
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).replace(/^ /, '')
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
      continue
    }
  }

  yield* emitEvent()
}

const extractTextFromEvent = (data: unknown): string => {
  if (typeof data === 'string') {
    return data
  }
  if (!isRecord(data)) {
    return ''
  }
  // Workflow apps stream their text output as `text_chunk` events, which nest it under `data`.
  if (data.event === 'text_chunk') {
    return isRecord(data.data) && typeof data.data.text === 'string' ? data.data.text : ''
  }
  if (typeof data.answer === 'string') {
    return data.answer
  }
  if (typeof data.text === 'string') {
    return data.text
  }
  if (typeof data.delta === 'string') {
    return data.delta
  }
  return ''
}

export const createSseStream = <T>(
  stream: Readable,
  meta: { status: number; headers: Headers; requestId?: string },
): DifyStream<T> => {
  const iterator = parseSseStream<T>(stream)[Symbol.asyncIterator]()
  const iterable = {
    [Symbol.asyncIterator]: () => iterator,
    data: stream,
    status: meta.status,
    headers: meta.headers,
    requestId: meta.requestId,
    toReadable: () => stream,
    toText: async () => {
      let text = ''
      for await (const event of iterable) {
        // Output moderation sends `message_replace` with the full answer that replaces everything streamed so far.
        if (isRecord(event.data) && event.data.event === 'message_replace') {
          text = typeof event.data.answer === 'string' ? event.data.answer : ''
          continue
        }
        text += extractTextFromEvent(event.data)
      }
      return text
    },
  } satisfies DifyStream<T>

  return iterable
}

export const createBinaryStream = (
  stream: Readable,
  meta: { status: number; headers: Headers; requestId?: string },
): BinaryStream => ({
  data: stream,
  status: meta.status,
  headers: meta.headers,
  requestId: meta.requestId,
  toReadable: () => stream,
})
