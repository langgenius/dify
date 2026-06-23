import type { ErrorBody } from '@dify/contracts/api/openapi/types.gen'
import { afterEach, describe, expect, it } from 'vitest'

import { setVerbose } from '@/framework/context'
import { HttpClientError } from './base'
import { ErrorCode } from './codes'
import { formatErrorForCli } from './format'

type ValidationErrorOverrides = {
  readonly cliHint?: string
  readonly serverHint?: string
  readonly details?: ErrorBody['details']
}

function validationError(overrides: ValidationErrorOverrides = {}): HttpClientError {
  const details
    = overrides.details
      ?? [
        { type: 'int_parsing', loc: ['page'], msg: 'must be >= 1' },
        { type: 'missing', loc: ['inputs', 'query'], msg: 'field required' },
      ]
  return new HttpClientError({
    code: ErrorCode.Server4xxOther,
    message: 'Request validation failed',
    httpStatus: 422,
    hint: overrides.cliHint,
    serverError: {
      code: 'invalid_param',
      message: 'Request validation failed',
      status: 422,
      hint: overrides.serverHint,
      details,
    },
  })
}

afterEach(() => {
  setVerbose(false)
})

describe('formatErrorForCli — human', () => {
  it('prints server code, message, and details without verbose', () => {
    const out = formatErrorForCli(validationError({ serverHint: 'check the page parameter' }), { isErrTTY: false })

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

  it('cli hint wins over server hint; server hint fills when cli sent none', () => {
    const withBothHints = validationError({ cliHint: 'cli local hint', serverHint: 'check the page parameter', details: [] })
    expect(formatErrorForCli(withBothHints, { isErrTTY: false })).toContain('cli local hint')
    expect(formatErrorForCli(withBothHints, { isErrTTY: false })).not.toContain('check the page parameter')

    // no cli hint → server hint shown
    const noCliHint = validationError({ serverHint: 'check the page parameter', details: [] })
    expect(formatErrorForCli(noCliHint, { isErrTTY: false })).toContain('check the page parameter')

    // no server hint → cli hint shown
    const noServerHint = new HttpClientError({
      code: ErrorCode.AuthExpired,
      message: 'session expired',
      hint: 'run difyctl auth login',
    })
    expect(formatErrorForCli(noServerHint, { isErrTTY: false })).toContain('run difyctl auth login')
  })

  it('omits the loc prefix when a detail has no loc', () => {
    const out = formatErrorForCli(
      validationError({ details: [{ type: 'invalid', loc: [], msg: 'body required' }] }),
      { isErrTTY: false },
    )

    expect(out).toContain('- body required (invalid)')
    expect(out).not.toContain('- : body required')
  })

  it('hints at -v when a raw response exists but is hidden', () => {
    const err = new HttpClientError({
      code: ErrorCode.Server4xxOther,
      message: 'request failed (HTTP 400)',
      httpStatus: 400,
      rawResponse: '<html>not json</html>',
    })

    const out = formatErrorForCli(err, { isErrTTY: false })

    expect(out).toContain('run again with -v to see the raw server response')
    expect(out).not.toContain('raw_response')
  })

  it('no -v hint when the server body parsed', () => {
    const err = new HttpClientError({
      code: ErrorCode.Server4xxOther,
      message: 'Request validation failed',
      httpStatus: 422,
      rawResponse: '{"code":"invalid_param","message":"Request validation failed","status":422}',
      serverError: { code: 'invalid_param', message: 'Request validation failed', status: 422 },
    })

    const out = formatErrorForCli(err, { isErrTTY: false })

    expect(out).not.toContain('run again with -v')
  })

  it('existing hints win over the -v hint', () => {
    const err = new HttpClientError({
      code: ErrorCode.Server4xxOther,
      message: 'request failed (HTTP 400)',
      httpStatus: 400,
      hint: 'cli hint',
      rawResponse: '<html>not json</html>',
    })

    const out = formatErrorForCli(err, { isErrTTY: false })

    expect(out).toContain('cli hint')
    expect(out).not.toContain('run again with -v')
  })

  it('shows raw_response instead of the -v hint when verbose', () => {
    setVerbose(true)
    const err = new HttpClientError({
      code: ErrorCode.Server4xxOther,
      message: 'request failed (HTTP 400)',
      httpStatus: 400,
      rawResponse: '<html>not json</html>',
    })

    const out = formatErrorForCli(err, { isErrTTY: false })

    expect(out).toContain('raw_response: <html>not json</html>')
    expect(out).not.toContain('run again with -v')
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
