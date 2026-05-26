export type HttpLogPhase = 'request' | 'response' | 'retry'

export type HttpLogEvent = {
  readonly phase: HttpLogPhase
  readonly method: string
  readonly url: string
  readonly status?: number
  readonly attempt?: number
  readonly durationMs?: number
}

export type HttpLogger = (event: HttpLogEvent) => void

export type HttpFactoryOptions = {
  readonly host: string
  readonly bearer?: string
  readonly timeoutMs?: number
  readonly retryAttempts?: number
  readonly userAgent?: string
  readonly logger?: HttpLogger
}
