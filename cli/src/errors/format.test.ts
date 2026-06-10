import { describe, expect, it } from 'vitest'
import { HttpClientError } from './base'
import { ErrorCode } from './codes'
import { formatErrorForCli } from './format'

function validationError(): HttpClientError {
  return new HttpClientError({
    code: ErrorCode.Server4xxOther,
    message: 'Request validation failed',
    httpStatus: 422,
    serverError: {
      code: 'invalid_param',
      message: 'Request validation failed',
      status: 422,
      hint: 'check the page parameter',
      details: [
        { type: 'int_parsing', loc: ['page'], msg: 'must be >= 1' },
        { type: 'missing', loc: ['inputs', 'query'], msg: 'field required' },
      ],
    },
  })
}

describe('formatErrorForCli — human', () => {
  it('prints server code, message, and details without verbose', () => {
    const out = formatErrorForCli(validationError(), { isErrTTY: false })

    expect(out).toContain('invalid_param: Request validation failed')
    expect(out).toContain('- page: must be >= 1 (int_parsing)')
    expect(out).toContain('- inputs.query: field required (missing)')
    expect(out).toContain('check the page parameter')
    expect(out).not.toContain('raw_response')
  })

  it('falls back to cli code when no server code', () => {
    const err = new HttpClientError({ code: ErrorCode.Server5xx, message: 'server error (HTTP 502)', httpStatus: 502 })

    const out = formatErrorForCli(err, { isErrTTY: false })

    expect(out).toContain('server_5xx: server error (HTTP 502)')
  })

  it('server hint wins over cli hint; cli hint fills when server sent none', () => {
    // validationError has server hint "check the page parameter"; cli hint is ignored
    const withCliHint = new HttpClientError({
      code: ErrorCode.Server4xxOther,
      message: 'Request validation failed',
      httpStatus: 422,
      hint: 'cli fallback hint',
      serverError: {
        code: 'invalid_param',
        message: 'Request validation failed',
        status: 422,
        hint: 'check the page parameter',
        details: [],
      },
    })
    expect(formatErrorForCli(withCliHint, { isErrTTY: false })).toContain('check the page parameter')
    expect(formatErrorForCli(withCliHint, { isErrTTY: false })).not.toContain('cli fallback hint')

    // no server hint → cli hint shown
    const noServerHint = new HttpClientError({
      code: ErrorCode.AuthExpired,
      message: 'session expired',
      hint: 'run difyctl auth login',
    })
    expect(formatErrorForCli(noServerHint, { isErrTTY: false })).toContain('run difyctl auth login')
  })

  it('renders request and http_status lines', () => {
    const err = new HttpClientError({
      code: ErrorCode.Server5xx,
      message: 'upstream boom',
      httpStatus: 502,
      method: 'GET',
      url: 'https://api.dify.ai/v1/me',
    })
    const out = formatErrorForCli(err, { isErrTTY: false })
    expect(out).toContain('request: GET https://api.dify.ai/v1/me')
    expect(out).toContain('http_status: 502')
  })
})

describe('formatErrorForCli — json', () => {
  it('envelope nests the whole server error', () => {
    const out = JSON.parse(formatErrorForCli(validationError(), { format: 'json' }))

    expect(out.error.server.code).toBe('invalid_param')
    expect(out.error.server.details).toHaveLength(2)
    expect(out.error.code).toBe('server_4xx_other')
  })
})
