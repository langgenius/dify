import { newError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'

export const LIMIT_MIN = 1
export const LIMIT_MAX = 200
export const LIMIT_DEFAULT = 20

const INTEGER_PATTERN = /^-?\d+$/

export function parseLimit(raw: string, source: string): number {
  if (!INTEGER_PATTERN.test(raw)) {
    throw newError(
      ErrorCode.UsageInvalidFlag,
      `${source}: ${JSON.stringify(raw)} is not a number`,
    )
  }
  const n = Number(raw)
  if (n < LIMIT_MIN || n > LIMIT_MAX) {
    throw newError(
      ErrorCode.UsageInvalidFlag,
      `${source}: ${n} out of range [${LIMIT_MIN}..${LIMIT_MAX}]`,
    )
  }
  return n
}
