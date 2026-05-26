import { describe, expect, it } from 'vitest'
import { resolveRetryAttempts } from './global-flags.js'

describe('resolveRetryAttempts', () => {
  it('returns flag value when given', () => {
    expect(resolveRetryAttempts({ flag: 1, env: () => undefined })).toBe(1)
  })

  it('returns 0 when flag is 0', () => {
    expect(resolveRetryAttempts({ flag: 0, env: () => undefined })).toBe(0)
  })

  it('falls back to DIFYCTL_HTTP_RETRY env when flag missing', () => {
    expect(resolveRetryAttempts({ flag: undefined, env: () => '5' })).toBe(5)
  })

  it('falls back to default 3 when flag and env missing', () => {
    expect(resolveRetryAttempts({ flag: undefined, env: () => undefined })).toBe(3)
  })

  it('throws typed BaseError with UsageInvalidFlag on non-numeric env', () => {
    let caught: unknown
    try {
      resolveRetryAttempts({ flag: undefined, env: () => 'foo' })
    }
    catch (e) {
      caught = e
    }
    expect((caught as { code: string }).code).toBe('usage_invalid_flag')
    expect((caught as Error).message).toMatch(/DIFYCTL_HTTP_RETRY/)
  })

  it('throws typed BaseError with UsageInvalidFlag on negative env', () => {
    let caught: unknown
    try {
      resolveRetryAttempts({ flag: undefined, env: () => '-1' })
    }
    catch (e) {
      caught = e
    }
    expect((caught as { code: string }).code).toBe('usage_invalid_flag')
    expect((caught as Error).message).toMatch(/DIFYCTL_HTTP_RETRY/)
  })
})
