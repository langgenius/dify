/** A failure event after an HTTP stream was established successfully. */
export class StreamError extends Error {
  readonly code: string | undefined
  readonly reason: string | undefined
  readonly hint: string | undefined
  readonly details: unknown
  readonly data: Record<string, unknown>

  constructor(data: Record<string, unknown>) {
    super(typeof data.message === 'string' && data.message.trim() ? data.message : 'Stream failed')
    this.name = 'StreamError'
    this.code = typeof data.code === 'string' ? data.code : undefined
    this.reason = typeof data.reason === 'string' ? data.reason : undefined
    this.hint = typeof data.hint === 'string' ? data.hint : undefined
    this.details = data.details
    this.data = data
  }
}
