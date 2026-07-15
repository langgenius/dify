import { describe, expect, it } from 'vitest'
import {
  classifyRateLimit,
  MAX_HONORED_WAIT_MS,
  parseRetryAfterMs,
  RATE_LIMIT_MAX_ATTEMPTS,
  rateLimitDelayMs,
} from './rate-limit.js'

function res429(body: unknown, headers?: Record<string, string>): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 429,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function headers(init?: Record<string, string>): Headers {
  return new Headers(init)
}

describe('classifyRateLimit', () => {
  it('throttle (code too_many_requests) is retryable and reads the Retry-After header', async () => {
    const d = await classifyRateLimit(
      res429({ code: 'too_many_requests', status: 429 }, { 'retry-after': '2' }),
    )
    expect(d).toEqual({ retryable: true, retryAfterMs: 2000 })
  })

  it('throttle without Retry-After is retryable with no advised wait', async () => {
    const d = await classifyRateLimit(res429({ code: 'too_many_requests', status: 429 }))
    expect(d).toEqual({ retryable: true, retryAfterMs: undefined })
  })

  it('quota (code rate_limit_error) is not retryable', async () => {
    const d = await classifyRateLimit(
      res429({ code: 'rate_limit_error', status: 429 }, { 'retry-after': '5' }),
    )
    expect(d.retryable).toBe(false)
    expect(d.retryAfterMs).toBeUndefined()
  })

  it.each([
    ['unknown code', { code: 'mystery' }],
    ['no code', { message: 'nope' }],
    ['non-JSON body', 'not json'],
  ])('unrecognized 429 (%s) is conservatively non-retryable', async (_label, body) => {
    const d = await classifyRateLimit(res429(body))
    expect(d.retryable).toBe(false)
  })

  it('reads the body off a clone (response stays consumable)', async () => {
    const r = res429({ code: 'too_many_requests', status: 429 })
    await classifyRateLimit(r)
    await expect(r.text()).resolves.toContain('too_many_requests')
  })
})

describe('parseRetryAfterMs', () => {
  it('reads integer-seconds Retry-After as ms', () => {
    expect(parseRetryAfterMs(headers({ 'retry-after': '3' }))).toBe(3000)
  })

  it('reads an HTTP-date relative to the injected now, clamped at 0', () => {
    const now = Date.parse('2026-06-11T00:00:00Z')
    expect(
      parseRetryAfterMs(headers({ 'retry-after': 'Thu, 11 Jun 2026 00:00:05 GMT' }), now),
    ).toBe(5000)
    expect(
      parseRetryAfterMs(headers({ 'retry-after': 'Thu, 11 Jun 2026 00:00:00 GMT' }), now + 10_000),
    ).toBe(0)
  })

  it('returns undefined when absent or unparseable', () => {
    expect(parseRetryAfterMs(headers())).toBeUndefined()
    expect(parseRetryAfterMs(headers({ 'retry-after': 'soon' }))).toBeUndefined()
  })
})

describe('rateLimitDelayMs', () => {
  it('returns the advised wait as-is (the caller already declined over-cap waits)', () => {
    expect(rateLimitDelayMs({ retryAfterMs: 800 }, 1)).toBe(800)
    expect(rateLimitDelayMs({ retryAfterMs: 5000 }, 1)).toBe(5000)
  })

  it('falls back to equal-jitter backoff when no wait is advised (rng pinned)', () => {
    // attempt 1 => backoffDelay 300; equal jitter => [150, 300].
    expect(rateLimitDelayMs({}, 1, { rng: () => 0 })).toBe(150)
    expect(rateLimitDelayMs({}, 1, { rng: () => 1 })).toBe(300)
  })

  it('returns 0 when there is neither an advised wait nor any backoff (attempt 0)', () => {
    expect(rateLimitDelayMs({}, 0, { rng: () => 0.5 })).toBe(0)
  })

  it('exposes sane retry constants', () => {
    expect(MAX_HONORED_WAIT_MS).toBe(60_000)
    expect(RATE_LIMIT_MAX_ATTEMPTS).toBe(3)
  })
})
