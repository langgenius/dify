import type { BaseError } from './base'

export type FormatErrorOptions = {
  readonly format?: string
  readonly isErrTTY?: boolean
}

export function formatErrorForCli(err: BaseError, opts: FormatErrorOptions = {}): string {
  if (opts.format === 'json')
    return err.renderEnvelope()
  return err.humanError(opts.isErrTTY ?? false)
}
