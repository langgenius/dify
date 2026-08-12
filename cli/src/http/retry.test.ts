import type { FetchContext, HttpMethod, ResolvedOptions } from './types.js'
import { describe, expect, it } from 'vitest'
import { backoffDelay, isIdempotentRetryMethod, shouldRetry } from './retry.js'

function ctxFor(method: HttpMethod): FetchContext {
  const options: ResolvedOptions = {
    method,
    headers: new Headers(),
    body: undefined,
    timeoutMs: undefined,
    retryAttempts: 0,
    throwOnError: true,
    retryOnRateLimit: false,
  }
  return {
    request: new Request('https://x/y', { method }),
    options,
    attempt: 0,
    meta: new Map(),
  }
}

describe('shouldRetry', () => {
  it('retries retryable status codes on GET', () => {
    const res = new Response(null, { status: 503 })
    expect(shouldRetry(res, ctxFor('GET'))).toBe(true)
  })

  it('does not retry non-retryable status codes on GET', () => {
    const res = new Response(null, { status: 404 })
    expect(shouldRetry(res, ctxFor('GET'))).toBe(false)
  })

  it('no longer retries 429 here (it has a dedicated branch in execute())', () => {
    const res = new Response(null, { status: 429 })
    expect(shouldRetry(res, ctxFor('GET'))).toBe(false)
  })

  it('does not retry POST regardless of status', () => {
    const res = new Response(null, { status: 503 })
    expect(shouldRetry(res, ctxFor('POST'))).toBe(false)
  })

  it('does not retry PATCH regardless of status', () => {
    const res = new Response(null, { status: 503 })
    expect(shouldRetry(res, ctxFor('PATCH'))).toBe(false)
  })

  it('retries transport errors on retryable methods', () => {
    expect(shouldRetry(new Error('econnreset'), ctxFor('GET'))).toBe(true)
    expect(shouldRetry(new Error('econnreset'), ctxFor('PUT'))).toBe(true)
  })

  it('does not retry transport errors on non-retryable methods', () => {
    expect(shouldRetry(new Error('econnreset'), ctxFor('POST'))).toBe(false)
  })
})

describe('isIdempotentRetryMethod', () => {
  it('is true for GET/PUT/DELETE and false for POST/PATCH', () => {
    expect(isIdempotentRetryMethod('GET')).toBe(true)
    expect(isIdempotentRetryMethod('PUT')).toBe(true)
    expect(isIdempotentRetryMethod('DELETE')).toBe(true)
    expect(isIdempotentRetryMethod('POST')).toBe(false)
    expect(isIdempotentRetryMethod('PATCH')).toBe(false)
  })
})

describe('backoffDelay', () => {
  it('returns 0 for attempts <= 0', () => {
    expect(backoffDelay(0)).toBe(0)
    expect(backoffDelay(-1)).toBe(0)
  })

  it('grows exponentially from a 300 ms base', () => {
    expect(backoffDelay(1)).toBe(300)
    expect(backoffDelay(2)).toBe(600)
    expect(backoffDelay(3)).toBe(1200)
    expect(backoffDelay(4)).toBe(2400)
  })

  it('caps at 30 s', () => {
    expect(backoffDelay(20)).toBe(30_000)
  })
})
