import { expect, it } from 'vite-plus/test'
import { ALL_ERROR_CODES, ErrorCode, ExitCode, exitFor } from './codes'

it('maps every code to the frozen exit taxonomy', () => {
  expect(exitFor(ErrorCode.NotLoggedIn)).toBe(ExitCode.Auth)
  expect(exitFor(ErrorCode.AccessDenied)).toBe(ExitCode.Auth)
  expect(exitFor(ErrorCode.InputInvalid)).toBe(ExitCode.Usage)
  expect(exitFor(ErrorCode.UsageInvalidFlag)).toBe(ExitCode.Usage)
  expect(exitFor(ErrorCode.CatalogUnavailable)).toBe(ExitCode.Catalog)
  expect(exitFor(ErrorCode.UnknownOp)).toBe(ExitCode.Catalog)
  expect(exitFor(ErrorCode.ConfigSchemaUnsupported)).toBe(ExitCode.Catalog)
  expect(exitFor(ErrorCode.RateLimited)).toBe(ExitCode.RateLimited)
  expect(exitFor(ErrorCode.ServerError)).toBe(ExitCode.Generic)
  expect(exitFor('something_from_the_future')).toBe(ExitCode.Generic)
  expect(new Set(Object.values(ExitCode))).toEqual(new Set([0, 1, 2, 4, 6, 7]))
  for (const code of ALL_ERROR_CODES) expect([0, 1, 2, 4, 6, 7]).toContain(exitFor(code))
})
