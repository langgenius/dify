import { colorEnabled, colorScheme } from '@/sys/io/color'
import { isVerbose } from '@/framework/context'
import { redactBearer } from '@/http/sanitize'

export type FormatErrorOptions = {
  readonly format?: string
  readonly isErrTTY?: boolean
}

export type ErrorEnvelope = {
  error: {
    code: string
    message: string
    hint?: string
    httpStatus?: number
    method?: string
    url?: string
    rawResponse?: string
  }
}

export interface PrintableError {
  toEnvelope: () => ErrorEnvelope
}

export function formatErrorForCli(err: PrintableError, opts: FormatErrorOptions = {}): string {
  const env = err.toEnvelope()
  if (opts.format === 'json')
    return renderEnvelope(env)
  return renderHuman(env, opts.isErrTTY ?? false)
}

function renderEnvelope(env: ErrorEnvelope): string {
  const raw = env.error.rawResponse
  if (raw === undefined)
    return JSON.stringify(env)
  if (!isVerbose()) {
    delete env.error.rawResponse
    return JSON.stringify(env)
  }
  env.error.rawResponse = redactBearer(raw)
  return JSON.stringify(env)
}

function renderHuman(env: ErrorEnvelope, isErrTTY: boolean): string {
  const cs = colorScheme(colorEnabled(isErrTTY))
  const e = env.error
  const lines: string[] = [`${e.code}: ${e.message}`]
  if (e.hint !== undefined)
    lines.push(`${cs.magenta('hint:')} ${cs.cyan(e.hint)}`)
  if (e.method !== undefined && e.url !== undefined)
    lines.push(`request: ${e.method} ${e.url}`)
  if (e.httpStatus !== undefined)
    lines.push(`http_status: ${e.httpStatus}`)
  if (isVerbose() && e.rawResponse)
    lines.push(`raw_response: ${redactBearer(e.rawResponse)}`)
  return lines.join('\n')
}
