import { describe, expect, it } from 'vitest'
import { BaseError, isBaseError, newError, unknownError } from './base.js'
import { ErrorCode, ExitCode } from './codes.js'

describe('BaseError', () => {
  it('captures code, message, optional fields', () => {
    const err = new BaseError({
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
    expect(newError(ErrorCode.NetworkDns, 'x').exit()).toBe(ExitCode.Generic)
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
    const built = newError(ErrorCode.NetworkTimeout, 'timed out')
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
    const wrapped = newError(ErrorCode.NetworkTimeout, 'timed out').wrap(cause)
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
