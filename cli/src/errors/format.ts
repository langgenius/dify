import type { BaseError } from './base.js'
import { colorEnabled, colorScheme } from '../sys/io/color.js'
import { renderEnvelope } from './envelope.js'

export type FormatErrorOptions = {
  readonly format?: string
  readonly isErrTTY?: boolean
}

export function formatErrorForCli(err: BaseError, opts: FormatErrorOptions = {}): string {
  if (opts.format === 'json')
    return renderEnvelope(err)
  return humanError(err, opts.isErrTTY ?? false)
}

function humanError(err: BaseError, isErrTTY: boolean): string {
  const cs = colorScheme(colorEnabled(isErrTTY))
  const lines: string[] = [`${err.code}: ${err.message}`]
  if (err.hint !== undefined)
    lines.push(`${cs.magenta('hint:')} ${cs.cyan(err.hint)}`)
  if (err.method !== undefined && err.url !== undefined)
    lines.push(`request: ${err.method} ${err.url}`)
  if (err.httpStatus !== undefined)
    lines.push(`http_status: ${err.httpStatus}`)
  return lines.join('\n')
}
