import { isVerbose } from '@/framework/context'
import { redactBearer } from '@/http/sanitize'
import { colorEnabled, colorScheme } from '@/sys/io/color'

export type FormatErrorOptions = {
  readonly format?: string
  readonly isErrTTY?: boolean
}

export type ErrorEnvelope = {
  error: {
    code: string
    message: string
    hint?: string
    http_status?: number
    method?: string
    url?: string
    raw_response?: string
  }
}

export type PrintableError = {
  toEnvelope: () => ErrorEnvelope
}

export function formatErrorForCli(err: PrintableError, opts: FormatErrorOptions = {}): string {
  const env = err.toEnvelope()
  if (opts.format === 'json')
    return renderEnvelope(env)
  return renderHuman(env, opts.isErrTTY ?? false)
}

function renderEnvelope(env: ErrorEnvelope): string {
  const raw = env.error.raw_response
  if (raw === undefined)
    return JSON.stringify(env)
  if (!isVerbose()) {
    delete env.error.raw_response
    return JSON.stringify(env)
  }
  env.error.raw_response = redactBearer(raw)
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
  if (e.http_status !== undefined)
    lines.push(`http_status: ${e.http_status}`)
  if (isVerbose() && e.raw_response)
    lines.push(`raw_response: ${redactBearer(e.raw_response)}`)
  return lines.join('\n')
}
