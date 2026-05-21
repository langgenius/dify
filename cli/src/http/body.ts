import type { BodyInit } from './types.js'

// `isJSONSerializable` ported from ofetch/src/utils.ts.
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
  readonly body: BodyInit | null
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
      return { body: null, contentType: undefined }
    if (isJSONSerializable(json))
      return { body: JSON.stringify(json), contentType: 'application/json' }
    return { body: json as BodyInit, contentType: undefined }
  }

  if (body !== undefined && isPayloadMethod)
    return { body, contentType: undefined }

  return { body: null, contentType: undefined }
}
