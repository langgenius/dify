import type { HttpClientError } from '@/errors/base'
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '@/errors/codes'
import { classifyResponse } from './error-mapper'

function res(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const req = new Request('https://dify.test/openapi/v1/apps')

function classified(status: number, body: unknown): Promise<HttpClientError> {
  return classifyResponse(req, res(status, body))
}

describe('classifyResponse — canonical ErrorBody', () => {
  it('attaches the parsed body whole as serverError', async () => {
    const body = {
      code: 'invalid_param',
      message: 'Request validation failed',
      status: 422,
      hint: 'check the page parameter',
      details: [{ type: 'int_parsing', loc: ['page'], msg: 'must be >= 1' }],
    }

    const err = await classified(422, body)

    expect(err.serverError).toEqual(body)
    expect(err.message).toBe('Request validation failed')
    expect(err.code).toBe(ErrorCode.Server4xxOther)
  })

  it('401 classifies by status as AuthExpired with CLI login hint', async () => {
    const err = await classified(401, {
      code: 'unauthorized',
      message: 'session expired or revoked',
      status: 401,
    })

    expect(err.code).toBe(ErrorCode.AuthExpired)
    expect(err.hint).toBe('run \'difyctl auth login\' to sign in again')
  })

  it('unknown future server code is data, not behavior — status bucket decides', async () => {
    const err = await classified(409, {
      code: 'some_future_code',
      message: 'nope',
      status: 409,
    })

    expect(err.code).toBe(ErrorCode.Server4xxOther)
    expect(err.serverError?.code).toBe('some_future_code')
  })

  it('429 classifies as RateLimited (dedicated exit code) and keeps the server code', async () => {
    const err = await classified(429, { code: 'too_many_requests', message: 'slow down', status: 429 })

    expect(err.code).toBe(ErrorCode.RateLimited)
    expect(err.exit()).toBe(7)
    expect(err.serverError?.code).toBe('too_many_requests')
  })

  it('429 with no parseable ErrorBody falls back to a generic rate-limit message', async () => {
    const err = await classified(429, 'not json')

    expect(err.code).toBe(ErrorCode.RateLimited)
    expect(err.serverError).toBeUndefined()
    expect(err.message).toBe('too many requests')
  })
})

describe('classifyResponse 403', () => {
  it('maps 403 to AccessDenied (exit 4 bucket)', async () => {
    const req403 = new Request('https://x/openapi/v1/apps/abc/export')
    const res403 = new Response(
      JSON.stringify({ code: 'unsupported_token_type', message: 'unsupported_token_type', status: 403 }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
    const err = await classifyResponse(req403, res403)
    expect(err.code).toBe(ErrorCode.AccessDenied)
    expect(err.message).toBe('unsupported_token_type')
  })

  it('403 with no parseable ErrorBody falls back to generic denied message', async () => {
    const err = await classified(403, 'not json')
    expect(err.code).toBe(ErrorCode.AccessDenied)
    expect(err.message).toBe('not permitted')
  })
})

describe('classifyResponse — non-conforming bodies (no fallback by design)', () => {
  it('non-JSON body yields no serverError, classification by status', async () => {
    const err = await classified(502, '<html>bad gateway</html>')

    expect(err.code).toBe(ErrorCode.Server5xx)
    expect(err.serverError).toBeUndefined()
  })

  it('RFC 8628 string error field yields no serverError and a generic message', async () => {
    const err = await classified(400, { error: 'slow_down' })

    expect(err.message).toBe('request failed (HTTP 400)')
    expect(err.serverError).toBeUndefined()
  })
})
