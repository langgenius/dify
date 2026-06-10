import { describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { classifyResponse } from './error-mapper'

function res(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const req = new Request('https://dify.test/openapi/v1/apps')

describe('classifyResponse — canonical ErrorBody', () => {
  it('attaches the parsed body whole as serverError', async () => {
    const body = {
      code: 'invalid_param',
      message: 'Request validation failed',
      status: 422,
      hint: 'check the page parameter',
      details: [{ type: 'int_parsing', loc: ['page'], msg: 'must be >= 1' }],
    }

    const err = await classifyResponse(req, res(422, body))

    expect(isHttpClientError(err)).toBe(true)
    if (!isHttpClientError(err))
      return
    expect(err.serverError).toEqual(body)
    expect(err.message).toBe('Request validation failed')
    expect(err.code).toBe(ErrorCode.Server4xxOther)
  })

  it('401 classifies by status as AuthExpired with CLI login hint', async () => {
    const err = await classifyResponse(req, res(401, {
      code: 'unauthorized',
      message: 'session expired or revoked',
      status: 401,
    }))

    expect(err.code).toBe(ErrorCode.AuthExpired)
    expect(err.hint).toBe('run \'difyctl auth login\' to sign in again')
  })

  it('unknown future server code is data, not behavior — status bucket decides', async () => {
    const err = await classifyResponse(req, res(409, {
      code: 'some_future_code',
      message: 'nope',
      status: 409,
    }))

    expect(err.code).toBe(ErrorCode.Server4xxOther)
    if (isHttpClientError(err))
      expect(err.serverError?.code).toBe('some_future_code')
  })
})

describe('classifyResponse — non-conforming bodies (no fallback by design)', () => {
  it('non-JSON body yields no serverError, classification by status', async () => {
    const err = await classifyResponse(req, res(502, '<html>bad gateway</html>'))

    expect(err.code).toBe(ErrorCode.Server5xx)
    if (isHttpClientError(err))
      expect(err.serverError).toBeUndefined()
  })

  it('RFC 8628 string error field yields no serverError and a generic message', async () => {
    const err = await classifyResponse(req, res(400, { error: 'slow_down' }))

    expect(err.message).toBe('request failed (HTTP 400)')
    if (isHttpClientError(err))
      expect(err.serverError).toBeUndefined()
  })
})
