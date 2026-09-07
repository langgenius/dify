import type { SessionRow } from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext, Registry } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { TokenStore } from '@/store/token-store'
import type { IOStreams } from '@/sys/io/streams'
import { AccountSessionsClient } from '@/api/account-sessions'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { LIMIT_DEFAULT, LIMIT_MAX, parseLimit } from '@/limit/limit'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { promptConfirm } from '@/sys/io/prompt'
import { runWithSpinner } from '@/sys/io/spinner'

export type DevicesListOptions = {
  readonly io: IOStreams
  readonly tokenId: string
  readonly http: HttpClient
  readonly json?: boolean
  readonly page?: number
  readonly limitRaw?: string
  readonly envLookup?: (k: string) => string | undefined
}

export async function runDevicesList(opts: DevicesListOptions): Promise<void> {
  const sessions = new AccountSessionsClient(opts.http)
  const env = opts.envLookup ?? ((k: string) => process.env[k])
  const limit = resolveLimit(opts.limitRaw, env)
  const page = opts.page === undefined || opts.page <= 0 ? 1 : opts.page
  const envelope = await runWithSpinner({ io: opts.io, label: 'Fetching devices' }, () =>
    sessions.list({ page, limit }),
  )

  if (opts.json === true) {
    opts.io.out.write(`${JSON.stringify(envelope)}\n`)
    return
  }

  opts.io.out.write(renderTable(envelope.data, opts.tokenId))
}

function resolveLimit(raw: string | undefined, env: (k: string) => string | undefined): number {
  if (raw !== undefined && raw !== '') return parseLimit(raw, '--limit')
  const envValue = env('DIFY_LIMIT')
  if (envValue !== undefined && envValue !== '') return parseLimit(envValue, 'DIFY_LIMIT')
  return LIMIT_DEFAULT
}

/**
 * Fetches every session across all pages. Used by revoke paths so that a
 * session sitting on page 2+ is still findable / revocable. Uses the max
 * page size (LIMIT_MAX) to minimize round-trips.
 */
export async function listAllSessions(
  client: AccountSessionsClient,
): Promise<readonly SessionRow[]> {
  const out: SessionRow[] = []
  let page = 1
  // Hard guard against a misbehaving server that lies about has_more.
  const MAX_PAGES = 100
  while (page <= MAX_PAGES) {
    const env = await client.list({ page, limit: LIMIT_MAX })
    out.push(...env.data)
    if (!env.has_more) return out
    page++
  }
  return out
}

export type DevicesRevokeOptions = {
  readonly io: IOStreams
  readonly reg: Registry
  readonly active: ActiveContext
  readonly store: TokenStore
  readonly http: HttpClient
  readonly target?: string
  readonly all: boolean
  readonly yes?: boolean
}

export async function runDevicesRevoke(opts: DevicesRevokeOptions): Promise<void> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  if (!opts.all && (opts.target === undefined || opts.target === '')) {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: 'specify a device label / id, or pass --all',
      hint: "see 'difyctl auth devices list'",
    })
  }

  const sessions = new AccountSessionsClient(opts.http)
  const rows = await listAllSessions(sessions)
  const { ids, selfHit } = pickTargets(rows, opts, opts.active.ctx.token_id ?? '')
  if (ids.length === 0) {
    opts.io.out.write('no sessions to revoke\n')
    return
  }

  if (opts.yes !== true && opts.io.isErrTTY) {
    const confirmed = await promptConfirm(opts.io, `Revoke ${ids.length} session(s)? [y/N] `)
    if (!confirmed) {
      throw new BaseError({
        code: ErrorCode.UsageMissingArg,
        message: 'aborted by user',
        hint: 'pass --yes to skip confirmation',
      })
    }
  }

  for (const id of ids) await sessions.revoke(id)

  if (selfHit) await opts.reg.forget(opts.active, opts.store)

  opts.io.out.write(`${cs.successIcon()} Revoked ${ids.length} session(s)\n`)
}

export type PickResult = {
  ids: readonly string[]
  selfHit: boolean
}

export function pickTargets(
  rows: readonly SessionRow[],
  opts: { target?: string; all: boolean },
  currentId: string,
): PickResult {
  if (opts.all) {
    const ids = rows.filter((r) => r.id !== currentId).map((r) => r.id)
    return { ids, selfHit: false }
  }
  const target = opts.target ?? ''
  const byLabel = rows.filter((r) => r.device_label === target)
  if (byLabel.length > 1) throw ambiguous(target, byLabel)
  const onlyLabel = byLabel[0]
  if (onlyLabel !== undefined) return { ids: [onlyLabel.id], selfHit: onlyLabel.id === currentId }

  const byId = rows.find((r) => r.id === target)
  if (byId !== undefined) return { ids: [byId.id], selfHit: byId.id === currentId }

  const needle = target.toLowerCase()
  const bySub = rows.filter((r) => r.device_label.toLowerCase().includes(needle))
  if (bySub.length > 1) throw ambiguous(target, bySub)
  const onlySub = bySub[0]
  if (onlySub !== undefined) return { ids: [onlySub.id], selfHit: onlySub.id === currentId }

  throw new BaseError({
    code: ErrorCode.UsageMissingArg,
    message: `no session matches "${target}"`,
  })
}

function ambiguous(target: string, rows: readonly SessionRow[]): BaseError {
  const labels = rows.map((r) => `${r.device_label} (${r.id})`).join(', ')
  return new BaseError({
    code: ErrorCode.UsageInvalidFlag,
    message: `"${target}" matches multiple sessions: ${labels}; pass an exact id to disambiguate`,
  })
}

function renderTable(rows: readonly SessionRow[], currentId: string): string {
  const header = ['DEVICE', 'CREATED', 'LAST USED', 'CURRENT']
  const body = rows.map((r) => [
    r.device_label !== '' ? r.device_label : r.id,
    r.created_at ?? '',
    r.last_used_at ?? '',
    r.id === currentId ? '*' : '',
  ])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => (row[i] ?? '').length)),
  )
  const fmt = (cells: readonly string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return body.length === 0 ? `${fmt(header)}\n` : `${[fmt(header), ...body.map(fmt)].join('\n')}\n`
}
