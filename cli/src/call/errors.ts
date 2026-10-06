import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

/** Every rejection of caller-supplied operation input, from load through request building. */
export function inputInvalid(message: string, cause?: unknown): BaseError {
  return new BaseError({ code: ErrorCode.InputInvalid, message, cause })
}
