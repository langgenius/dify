import type { ErrorCodeValue, ExitCodeValue } from './codes.js'
import { ErrorCode, exitFor } from './codes.js'

export type BaseErrorOptions = {
  readonly code: ErrorCodeValue
  readonly message: string
  readonly hint?: string
  readonly httpStatus?: number
  readonly method?: string
  readonly url?: string
  readonly cause?: unknown
}

export class BaseError extends Error {
  readonly code: ErrorCodeValue
  readonly hint?: string
  readonly httpStatus?: number
  readonly method?: string
  readonly url?: string

  constructor(opts: BaseErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = 'BaseError'
    this.code = opts.code
    this.hint = opts.hint
    this.httpStatus = opts.httpStatus
    this.method = opts.method
    this.url = opts.url
    Object.setPrototypeOf(this, new.target.prototype)
  }

  exit(): ExitCodeValue {
    return exitFor(this.code)
  }

  override toString(): string {
    return this.hint
      ? `${this.code}: ${this.message} (hint: ${this.hint})`
      : `${this.code}: ${this.message}`
  }

  withHint(hint: string): BaseError {
    return new BaseError({ ...this.snapshot(), hint })
  }

  withHttpStatus(httpStatus: number): BaseError {
    return new BaseError({ ...this.snapshot(), httpStatus })
  }

  withRequest(method: string, url: string): BaseError {
    return new BaseError({ ...this.snapshot(), method, url })
  }

  wrap(cause: unknown): BaseError {
    return new BaseError({ ...this.snapshot(), cause })
  }

  private snapshot(): BaseErrorOptions {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      httpStatus: this.httpStatus,
      method: this.method,
      url: this.url,
      cause: this.cause,
    }
  }
}

export function newError(code: ErrorCodeValue, message: string): BaseError {
  return new BaseError({ code, message })
}

export function isBaseError(value: unknown): value is BaseError {
  return value instanceof BaseError
}

export function unknownError(message: string, cause?: unknown): BaseError {
  return new BaseError({ code: ErrorCode.Unknown, message, cause })
}
