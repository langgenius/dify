import type { BodyInit } from './types.js'

// Reports whether a value should be JSON-stringified for the wire: primitives,
// plain objects, arrays, and anything with a `toJSON` method — but not typed
// arrays/buffers, FormData, or URLSearchParams, which are sent as-is.
export function isJSONSerializable(value: unknown): boolean {
  if (value === undefined)
    return false
  if (value === null)
    return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean')
    return true
  if (t !== 'object')
    return false
  if (Array.isArray(value))
    return true
  const obj = value as { buffer?: unknown, constructor?: { name?: string }, toJSON?: unknown }
  if (obj.buffer !== undefined)
    return false
  if (value instanceof FormData || value instanceof URLSearchParams)
    return false
  if (obj.constructor?.name === 'Object')
    return true
  return typeof obj.toJSON === 'function'
}

export type BuildBodyInput = {
  readonly json?: unknown
  readonly body?: BodyInit
  readonly method: string
}

export type BuildBodyResult = {
  readonly body: BodyInit | undefined
  readonly contentType: string | undefined
}

// Decide the wire body and whether Content-Type should be injected.
// json wins over body when both are provided; tests assert single-source-of-truth via type system,
// but at runtime we still prefer json explicitly.
export function buildBody(input: BuildBodyInput): BuildBodyResult {
  const { json, body, method } = input
  const isPayloadMethod = method !== 'GET' && method !== 'HEAD'

  if (json !== undefined) {
    if (!isPayloadMethod)
      return { body: undefined, contentType: undefined }
    if (isJSONSerializable(json))
      return { body: JSON.stringify(json), contentType: 'application/json' }
    return { body: json as BodyInit, contentType: undefined }
  }

  // A raw `body` is passed through untouched. This is replay-safe only for buffered
  // payloads (string, Blob, FormData, typed arrays) — a single-shot ReadableStream
  // would be consumed on the first attempt and replay empty on retry. Safe today
  // because the only stream/multipart caller (file-upload) uses POST, which is not
  // in RETRY_METHODS; revisit if a ReadableStream body is ever sent over GET/PUT/DELETE.
  if (body !== undefined && isPayloadMethod)
    return { body, contentType: undefined }

  return { body: undefined, contentType: undefined }
}
