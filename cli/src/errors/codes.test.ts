import { describe, expect, it } from 'vitest'
import {
  ALL_ERROR_CODES,
  CODE_TO_EXIT_MAP,
  ErrorCode,
  ExitCode,
  exitFor,
} from './codes.js'

describe('error codes', () => {
  it('has 17 codes (parity with internal/api/errors)', () => {
    expect(ALL_ERROR_CODES).toHaveLength(17)
  })

  it('has the expected ExitCode buckets', () => {
    expect(ExitCode.Success).toBe(0)
    expect(ExitCode.Generic).toBe(1)
    expect(ExitCode.Usage).toBe(2)
    expect(ExitCode.Auth).toBe(4)
    expect(ExitCode.VersionCompat).toBe(6)
  })

  it('every code maps to an exit', () => {
    for (const code of ALL_ERROR_CODES)
      expect(CODE_TO_EXIT_MAP[code]).toBeDefined()
  })

  it('CODE_TO_EXIT_MAP entry count == ALL_ERROR_CODES length (drift guard)', () => {
    expect(Object.keys(CODE_TO_EXIT_MAP)).toHaveLength(ALL_ERROR_CODES.length)
  })

  it.each([
    [ErrorCode.NotLoggedIn, ExitCode.Auth],
    [ErrorCode.AuthExpired, ExitCode.Auth],
    [ErrorCode.TokenExpired, ExitCode.Auth],
    [ErrorCode.AccessDenied, ExitCode.Auth],
    [ErrorCode.ExpiredToken, ExitCode.Auth],
    [ErrorCode.VersionSkew, ExitCode.VersionCompat],
    [ErrorCode.UnsupportedEndpoint, ExitCode.VersionCompat],
    [ErrorCode.ConfigSchemaUnsupported, ExitCode.VersionCompat],
    [ErrorCode.UsageInvalidFlag, ExitCode.Usage],
    [ErrorCode.UsageMissingArg, ExitCode.Usage],
    [ErrorCode.ConfigInvalidKey, ExitCode.Usage],
    [ErrorCode.ConfigInvalidValue, ExitCode.Usage],
    [ErrorCode.NetworkTimeout, ExitCode.Generic],
    [ErrorCode.NetworkDns, ExitCode.Generic],
    [ErrorCode.Server5xx, ExitCode.Generic],
    [ErrorCode.Server4xxOther, ExitCode.Generic],
    [ErrorCode.Unknown, ExitCode.Generic],
  ])('exitFor(%s) -> %d', (code, want) => {
    expect(exitFor(code)).toBe(want)
  })

  it('exitFor returns ExitCode.Generic for unknown code (conservative default)', () => {
    expect(exitFor('no_such_code')).toBe(ExitCode.Generic)
  })
})
