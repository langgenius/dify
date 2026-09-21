import type { ErrorCodeValue, ExitCodeValue } from './codes'
import { BINARY } from '@/version/info'
import { ErrorCode, exitFor } from './codes'

export type ServerErrorDetail = {
  readonly type: string
  readonly loc?: (string | number)[]
  readonly msg: string
}

export type ServerErrorBody = {
  readonly code: string
  readonly message: string
  readonly status?: number
  readonly hint?: string
  readonly details?: ServerErrorDetail[]
}

export type ErrorEnvelope = {
  error: {
    code: string
    message: string
    hint?: string
    details?: ServerErrorDetail[]
    schema?: unknown
    http_status?: number
    method?: string
    url?: string
    raw_response?: string
    server?: ServerErrorBody
  }
}

export type BaseErrorOptions = {
  readonly code: ErrorCodeValue
  readonly message: string
  readonly hint?: string
  readonly cause?: unknown
  readonly details?: ServerErrorDetail[]
  readonly schema?: unknown
}

export class BaseError extends Error {
  readonly code: ErrorCodeValue
  readonly hint?: string
  readonly details?: ServerErrorDetail[]
  readonly schema?: unknown

  constructor(opts: BaseErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = 'BaseError'
    this.code = opts.code
    this.hint = opts.hint
    this.details = opts.details
    this.schema = opts.schema

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

  toEnvelope(): ErrorEnvelope {
    const payload: ErrorEnvelope['error'] = {
      code: this.code,
      message: this.message,
    }
    if (this.hint !== undefined) payload.hint = this.hint
    if (this.details !== undefined) payload.details = this.details
    if (this.schema !== undefined) payload.schema = this.schema
    return { error: payload }
  }

  withHint<T extends BaseError>(this: T, hint: string): T {
    const Ctor = this.constructor as new (opts: BaseErrorOptions) => T
    return new Ctor({ ...this.snapshot(), hint })
  }

  wrap<T extends BaseError>(this: T, cause: unknown): T {
    const Ctor = this.constructor as new (opts: BaseErrorOptions) => T
    return new Ctor({ ...this.snapshot(), cause })
  }

  protected snapshot(): BaseErrorOptions {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      cause: this.cause,
      details: this.details,
      schema: this.schema,
    }
  }
}

export function newError(code: ErrorCodeValue, message: string): BaseError {
  return new BaseError({ code, message })
}

export function isBaseError(value: unknown): value is BaseError {
  return value instanceof BaseError
}

export function isHttpClientError(value: unknown): value is HttpClientError {
  return value instanceof HttpClientError
}

export function unknownError(message: string, cause?: unknown): BaseError {
  return new BaseError({ code: ErrorCode.Unknown, message, cause })
}

export const LOGIN_HINT = `run ${BINARY} login`

export function notLoggedIn(): BaseError {
  return new BaseError({ code: ErrorCode.NotLoggedIn, message: 'not logged in', hint: LOGIN_HINT })
}

type HttpClientErrorOptions = BaseErrorOptions & {
  readonly httpStatus?: number
  readonly method?: string
  readonly url?: string
  readonly rawResponse?: string
  readonly serverError?: ServerErrorBody
}

export class HttpClientError extends BaseError {
  readonly httpStatus?: number
  readonly method?: string
  readonly url?: string
  readonly rawResponse?: string
  readonly serverError?: ServerErrorBody

  constructor(opts: HttpClientErrorOptions) {
    super(opts)
    this.httpStatus = opts.httpStatus
    this.method = opts.method
    this.url = opts.url
    this.rawResponse = opts.rawResponse
    this.serverError = opts.serverError
  }

  override toEnvelope(): ErrorEnvelope {
    const envelope = super.toEnvelope()
    if (this.httpStatus !== undefined) envelope.error.http_status = this.httpStatus
    if (this.method !== undefined) envelope.error.method = this.method
    if (this.url !== undefined) envelope.error.url = this.url
    if (this.rawResponse !== undefined) envelope.error.raw_response = this.rawResponse
    if (this.serverError !== undefined) envelope.error.server = this.serverError
    // One details[] surface for both client- and server-authored rejections: the
    // server's own details fill in only when this error didn't already have its own.
    if (envelope.error.details === undefined && this.serverError?.details !== undefined)
      envelope.error.details = this.serverError.details
    return envelope
  }

  protected override snapshot(): HttpClientErrorOptions {
    return {
      ...super.snapshot(),
      httpStatus: this.httpStatus,
      method: this.method,
      url: this.url,
      rawResponse: this.rawResponse,
      serverError: this.serverError,
    }
  }

  public static from(error: BaseError): HttpClientError {
    return new HttpClientError({
      code: error.code,
      message: error.message,
      hint: error.hint,
      cause: error.cause,
      details: error.details,
      schema: error.schema,
    })
  }

  withHttpStatus(httpStatus: number): HttpClientError {
    return new HttpClientError({ ...this.snapshot(), httpStatus })
  }

  withRequest(method: string, url: string): HttpClientError {
    return new HttpClientError({ ...this.snapshot(), method, url })
  }

  withRawResponse(rawResponse: string): HttpClientError {
    if (!rawResponse) {
      return this
    }
    return new HttpClientError({ ...this.snapshot(), rawResponse })
  }

  withServerError(serverError: ServerErrorBody): HttpClientError {
    return new HttpClientError({ ...this.snapshot(), serverError })
  }
}
