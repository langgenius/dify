import type { ErrorCodeValue, ExitCodeValue } from './codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { ErrorCode, exitFor } from './codes'
import { isVerbose } from '@/framework/context'

export type BaseErrorOptions = {
  readonly code: ErrorCodeValue
  readonly message: string
  readonly hint?: string
  readonly cause?: unknown
}

export type ErrorEnvelope = {
  error: {
    code: string
    message: string
    hint?: string
    http_status?: number
    method?: string
    url?: string
  }
}

export class BaseError extends Error {
  readonly code: ErrorCodeValue
  readonly hint?: string

  constructor(opts: BaseErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = 'BaseError'
    this.code = opts.code
    this.hint = opts.hint

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

  humanError(isErrTTY: boolean): string {
    const cs = colorScheme(colorEnabled(isErrTTY))
    const lines: string[] = [`${this.code}: ${this.message}`]
    if (this.hint !== undefined)
      lines.push(`${cs.magenta('hint:')} ${cs.cyan(this.hint)}`)
    return lines.join('\n')
  }

  toEnvelope(): ErrorEnvelope {
    const payload: ErrorEnvelope['error'] = {
      code: this.code,
      message: this.message,
    }
    if (this.hint !== undefined)
      payload.hint = this.hint
    return { error: payload }
  }

  renderEnvelope(): string {
    return JSON.stringify(this.toEnvelope())
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

type HttpClientErrorOptions = BaseErrorOptions & {
  readonly httpStatus?: number
  readonly method?: string
  readonly url?: string
  readonly rawResponse?: string
}

export class HttpClientError extends BaseError {
  readonly httpStatus?: number
  readonly method?: string
  readonly url?: string
  readonly rawResponse?: string

  constructor(opts: HttpClientErrorOptions) {
    super(opts)
    this.httpStatus = opts.httpStatus
    this.method = opts.method
    this.url = opts.url
    this.rawResponse = opts.rawResponse
  }

  override humanError(isErrTTY: boolean): string {
    
    const lines: string[] = [super.humanError(isErrTTY)]
    if (this.method !== undefined && this.url !== undefined)
      lines.push(`request: ${this.method} ${this.url}`)
    if (this.httpStatus !== undefined)
      lines.push(`http_status: ${this.httpStatus}`)
    if (isVerbose() && this.rawResponse)
      lines.push(`raw_response: ${this.rawResponse}`)
    return lines.join('\n')
  }

  override toEnvelope(): ErrorEnvelope {
    const envelope = super.toEnvelope()
    if (this.httpStatus !== undefined)
      envelope.error.http_status = this.httpStatus
    if (this.method !== undefined)
      envelope.error.method = this.method
    if (this.url !== undefined)
      envelope.error.url = this.url
    return envelope
  }

  protected override snapshot(): HttpClientErrorOptions {
    return {
      ...super.snapshot(),
      httpStatus: this.httpStatus,
      method: this.method,
      url: this.url,
      rawResponse: this.rawResponse,
    }
  }

  public static from(error: BaseError): HttpClientError {
    return new HttpClientError({
      code: error.code,
      message: error.message,
      hint: error.hint,
      cause: error.cause,
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
}
