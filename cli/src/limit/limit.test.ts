import { describe, expect, it } from 'vitest'
import { isBaseError } from '../errors/base.js'
import { ExitCode } from '../errors/codes.js'
import { LIMIT_DEFAULT, LIMIT_MAX, LIMIT_MIN, parseLimit } from './limit.js'

describe('limit', () => {
  it('constants match Go original', () => {
    expect(LIMIT_MIN).toBe(1)
    expect(LIMIT_MAX).toBe(200)
    expect(LIMIT_DEFAULT).toBe(20)
  })

  it.each([1, 20, 50, 200])('accepts %d', (n) => {
    expect(parseLimit(String(n), '--limit')).toBe(n)
  })

  it.each([0, -1, 201, 1000])('rejects %d as out of range', (n) => {
    let err: unknown
    try {
      parseLimit(String(n), '--limit')
    }
    catch (e) {
      err = e
    }
    expect(isBaseError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('usage_invalid_flag')
    expect((err as { exit: () => number }).exit()).toBe(ExitCode.Usage)
    expect((err as Error).message).toMatch(/out of range/)
  })

  it('rejects non-numeric with typed UsageInvalidFlag', () => {
    let err: unknown
    try {
      parseLimit('abc', '--limit')
    }
    catch (e) {
      err = e
    }
    expect(isBaseError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('usage_invalid_flag')
    expect((err as Error).message).toMatch(/not a number/)
  })

  it('rejects empty string with typed UsageInvalidFlag', () => {
    let err: unknown
    try {
      parseLimit('', '--limit')
    }
    catch (e) {
      err = e
    }
    expect(isBaseError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('usage_invalid_flag')
  })

  it('rejects floats (mirroring Go strconv.Atoi behaviour)', () => {
    expect(() => parseLimit('1.5', '--limit')).toThrow(/not a number/)
  })

  it('error message names the source knob', () => {
    expect(() => parseLimit('999', 'DIFY_LIMIT')).toThrow(/DIFY_LIMIT/)
    expect(() => parseLimit('999', 'defaults.limit')).toThrow(/defaults\.limit/)
  })
})
