import { describe, expect, it } from 'vitest'
import { BaseError, HttpClientError, isBaseError, newError, unknownError } from './base'
import { ErrorCode, ExitCode } from './codes'

describe('BaseError', () => {
  it('captures code, message, optional fields', () => {
    const err = new HttpClientError({
      code: ErrorCode.AuthExpired,
      message: 'session expired',
      hint: 'run difyctl auth login',
      httpStatus: 401,
      method: 'GET',
      url: 'https://x/y',
    })
    expect(err.code).toBe(ErrorCode.AuthExpired)
    expect(err.message).toBe('session expired')
    expect(err.hint).toBe('run difyctl auth login')
    expect(err.httpStatus).toBe(401)
    expect(err.method).toBe('GET')
    expect(err.url).toBe('https://x/y')
  })

  it('is an Error instance and instanceof BaseError', () => {
    const err = newError(ErrorCode.Unknown, 'x')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(BaseError)
  })

  it('exit() routes via code map', () => {
    expect(newError(ErrorCode.AuthExpired, 'x').exit()).toBe(ExitCode.Auth)
    expect(newError(ErrorCode.UsageInvalidFlag, 'x').exit()).toBe(ExitCode.Usage)
    expect(newError(ErrorCode.VersionSkew, 'x').exit()).toBe(ExitCode.VersionCompat)
  })

  it('toString without hint formats "<code>: <message>"', () => {
    const err = newError(ErrorCode.AuthExpired, 'session expired')
    expect(err.toString()).toBe('auth_expired: session expired')
  })

  it('toString with hint formats "<code>: <message> (hint: <hint>)"', () => {
    const err = newError(ErrorCode.AuthExpired, 'session expired')
      .withHint('run \'difyctl auth login\'')
    expect(err.toString()).toBe(
      'auth_expired: session expired (hint: run \'difyctl auth login\')',
    )
  })

  it('builder methods return new instances; original unchanged', () => {
    const original = newError(ErrorCode.Unknown, 'boom')
    const hinted = original.withHint('try again')
    expect(original.hint).toBeUndefined()
    expect(hinted.hint).toBe('try again')
    expect(hinted).not.toBe(original)
  })

  it('withHttpStatus + withRequest + wrap chain immutably', () => {
    const cause = new Error('underlying')
    const built = HttpClientError.from(newError(ErrorCode.NetworkConnection, 'timed out'))
      .withHttpStatus(504)
      .withRequest('POST', 'https://x/y')
      .wrap(cause)
    expect(built.httpStatus).toBe(504)
    expect(built.method).toBe('POST')
    expect(built.url).toBe('https://x/y')
    expect(built.cause).toBe(cause)
  })

  it('wrap exposes cause via standard Error.cause property', () => {
    const cause = new Error('underlying failure')
    const wrapped = newError(ErrorCode.NetworkConnection, 'timed out').wrap(cause)
    expect(wrapped.cause).toBe(cause)
  })

  it('isBaseError narrows unknown values', () => {
    expect(isBaseError(newError(ErrorCode.Unknown, 'x'))).toBe(true)
    expect(isBaseError(new Error('plain'))).toBe(false)
    expect(isBaseError({ code: 'unknown' })).toBe(false)
    expect(isBaseError(undefined)).toBe(false)
  })

  it('unknownError factory wraps cause and uses ErrorCode.Unknown', () => {
    const cause = new Error('boom')
    const err = unknownError('something failed', cause)
    expect(err.code).toBe(ErrorCode.Unknown)
    expect(err.cause).toBe(cause)
  })
})

describe('error envelope', () => {
  it('emits required fields only when minimal', () => {
    const err = newError(ErrorCode.Unknown, 'boom')
    expect(err.toEnvelope()).toEqual({
      error: { code: 'unknown', message: 'boom' },
    })
  })

  it('includes hint / http_status / method / url when present', () => {
    const err = HttpClientError.from(newError(ErrorCode.NetworkConnection, 'timed out'))
      .withHint('check your network')
      .withHttpStatus(504)
      .withRequest('POST', 'https://api.dify.ai/v1/x')
    expect(err.toEnvelope()).toEqual({
      error: {
        code: 'network_connection',
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
    const out = JSON.stringify(err.toEnvelope())
    expect(out).toBe(
      '{"error":{"code":"auth_expired","message":"session expired","hint":"run difyctl auth login"}}',
    )
    expect(out).not.toContain('\n')
  })

  it('renderEnvelope output round-trips through JSON.parse to an ErrorEnvelope shape', () => {
    const err = newError(ErrorCode.UsageInvalidFlag, 'bad flag').withHint('see --help')
    const parsed = JSON.parse(JSON.stringify(err.toEnvelope()))
    expect(parsed).toEqual({
      error: { code: 'usage_invalid_flag', message: 'bad flag', hint: 'see --help' },
    })
  })

  it('omits undefined optional fields entirely (no `hint: null`)', () => {
    const err = newError(ErrorCode.Server5xx, 'upstream broke')
    const envelope = err.toEnvelope()
    expect(envelope.error).not.toHaveProperty('hint')
    expect(envelope.error).not.toHaveProperty('http_status')
    expect(envelope.error).not.toHaveProperty('method')
    expect(envelope.error).not.toHaveProperty('url')
  })
})
