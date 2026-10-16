import type { ErrorDetail, ErrorEnvelope } from './base'
import type { Hint } from '@/protocol/hint'
import type { Style } from '@/sys/io/color'
import { LOC_SEPARATOR } from '@/errors/base'
import { redactBearer } from '@/errors/sanitize'
import { spacedId } from '@/protocol/op-id'
import { BINARY } from '@/version/info'

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

function detailLine(d: ErrorDetail): string {
  if (d.field !== undefined) return `${d.field}: ${d.msg}`
  const loc = (d.loc ?? []).join(LOC_SEPARATOR)
  return `${loc ? `${loc}: ` : ''}${d.msg} (${d.type})`
}

function nextLine(h: Hint, style: Style): string {
  return `${style.magenta('next:')} ${style.cyan(`${BINARY} ${spacedId(h.op)}`)} — ${h.summary}`
}

export function renderEnvelope(env: ErrorEnvelope, style: Style, opts: RenderOptions): string {
  const e = env.error
  const server = e.server
  const headerCode = server?.code ?? e.code
  const lines: string[] = [`${headerCode}: ${e.message}`]
  for (const d of e.details ?? server?.details ?? []) lines.push(`  - ${detailLine(d)}`)
  const hint = resolveHint(e, opts)
  if (hint !== undefined) lines.push(`${style.magenta('hint:')} ${style.cyan(hint)}`)
  for (const h of server?.hints ?? []) lines.push(nextLine(h, style))
  if (e.method !== undefined && e.url !== undefined) lines.push(`request: ${e.method} ${e.url}`)
  if (e.http_status !== undefined) lines.push(`http_status: ${e.http_status}`)
  if (opts.verbose && e.raw_response) lines.push(`raw_response: ${redactBearer(e.raw_response)}`)
  return lines.join('\n')
}
