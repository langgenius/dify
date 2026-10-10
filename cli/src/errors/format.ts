import type { ErrorEnvelope } from './base'
import type { Style } from '@/sys/io/color'
import { redactBearer } from '@/errors/sanitize'

const RAW_RESPONSE_HINT = 'run again with --verbose to see the raw server response'

type RenderOptions = { readonly verbose: boolean }

// CLI-authored hint wins: it knows local remediation (e.g. which command to
// run); the server hint fills in when the CLI has nothing for this error.
function resolveHint(e: ErrorEnvelope['error'], opts: RenderOptions): string | undefined {
  if (e.hint !== undefined) return e.hint
  if (e.server?.hint != null) return e.server.hint
  const rawHiddenAndUnparsed = e.server === undefined && Boolean(e.raw_response) && !opts.verbose
  return rawHiddenAndUnparsed ? RAW_RESPONSE_HINT : undefined
}

export function renderEnvelope(env: ErrorEnvelope, style: Style, opts: RenderOptions): string {
  const e = env.error
  const server = e.server
  const headerCode = server?.code ?? e.code
  const lines: string[] = [`${headerCode}: ${e.message}`]
  for (const d of e.details ?? server?.details ?? []) {
    const loc = (d.loc ?? []).join('.')
    lines.push(`  - ${loc ? `${loc}: ` : ''}${d.msg} (${d.type})`)
  }
  const hint = resolveHint(e, opts)
  if (hint !== undefined) lines.push(`${style.magenta('hint:')} ${style.cyan(hint)}`)
  if (e.method !== undefined && e.url !== undefined) lines.push(`request: ${e.method} ${e.url}`)
  if (e.http_status !== undefined) lines.push(`http_status: ${e.http_status}`)
  if (opts.verbose && e.raw_response) lines.push(`raw_response: ${redactBearer(e.raw_response)}`)
  return lines.join('\n')
}
