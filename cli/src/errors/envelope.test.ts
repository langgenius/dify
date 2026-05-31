import { describe, expect, it } from 'vitest'
import { newError } from './base.js'
import { ErrorCode } from './codes.js'
import { renderEnvelope, toEnvelope } from './envelope.js'

describe('error envelope', () => {
  it('emits required fields only when minimal', () => {
    const err = newError(ErrorCode.Unknown, 'boom')
    expect(toEnvelope(err)).toEqual({
      error: { code: 'unknown', message: 'boom' },
    })
  })

  it('includes hint / http_status / method / url when present', () => {
    const err = newError(ErrorCode.NetworkTimeout, 'timed out')
      .withHint('check your network')
      .withHttpStatus(504)
      .withRequest('POST', 'https://api.dify.ai/v1/x')
    expect(toEnvelope(err)).toEqual({
      error: {
        code: 'network_timeout',
        message: 'timed out',
        hint: 'check your network',
        http_status: 504,
        method: 'POST',
        url: 'https://api.dify.ai/v1/x',
      },
    })
  })

  it('renderEnvelope returns a single-line JSON string', () => {
    const err = newError(ErrorCode.AuthExpired, 'session expired')
      .withHint('run difyctl auth login')
    const out = renderEnvelope(err)
    expect(out).toBe(
      '{"error":{"code":"auth_expired","message":"session expired","hint":"run difyctl auth login"}}',
    )
    expect(out).not.toContain('\n')
  })

  it('renderEnvelope output round-trips through JSON.parse to an ErrorEnvelope shape', () => {
    const err = newError(ErrorCode.UsageInvalidFlag, 'bad flag').withHint('see --help')
    const parsed = JSON.parse(renderEnvelope(err))
    expect(parsed).toEqual({
      error: { code: 'usage_invalid_flag', message: 'bad flag', hint: 'see --help' },
    })
  })

  it('omits undefined optional fields entirely (no `hint: null`)', () => {
    const err = newError(ErrorCode.Server5xx, 'upstream broke')
    const envelope = toEnvelope(err)
    expect(envelope.error).not.toHaveProperty('hint')
    expect(envelope.error).not.toHaveProperty('http_status')
    expect(envelope.error).not.toHaveProperty('method')
    expect(envelope.error).not.toHaveProperty('url')
  })
})
