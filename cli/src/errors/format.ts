import type { ErrorBody } from '@dify/contracts/api/openapi/types.gen'
import { isVerbose } from '@/framework/context'
import { redactBearer } from '@/http/sanitize'
import { colorEnabled, colorScheme } from '@/sys/io/color'

const RAW_RESPONSE_HINT = 'run again with -v to see the raw server response'

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
    server?: ErrorBody
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

// CLI-authored hint wins: it knows local remediation (e.g. which command to
// run); the server hint fills in when the CLI has nothing for this error.
function resolveHint(e: ErrorEnvelope['error']): string | undefined {
  if (e.hint !== undefined)
    return e.hint
  if (e.server?.hint != null)
    return e.server.hint
  const rawHiddenAndUnparsed = e.server === undefined && Boolean(e.raw_response) && !isVerbose()
  return rawHiddenAndUnparsed ? RAW_RESPONSE_HINT : undefined
}

function renderHuman(env: ErrorEnvelope, isErrTTY: boolean): string {
  const cs = colorScheme(colorEnabled(isErrTTY))
  const e = env.error
  const server = e.server
  const headerCode = server?.code ?? e.code
  const lines: string[] = [`${headerCode}: ${e.message}`]
  for (const d of server?.details ?? []) {
    const loc = (d.loc ?? []).join('.')
    lines.push(`  - ${loc ? `${loc}: ` : ''}${d.msg} (${d.type})`)
  }
  const hint = resolveHint(e)
  if (hint !== undefined)
    lines.push(`${cs.magenta('hint:')} ${cs.cyan(hint)}`)
  if (e.method !== undefined && e.url !== undefined)
    lines.push(`request: ${e.method} ${e.url}`)
  if (e.http_status !== undefined)
    lines.push(`http_status: ${e.http_status}`)
  if (isVerbose() && e.raw_response)
    lines.push(`raw_response: ${redactBearer(e.raw_response)}`)
  return lines.join('\n')
}
