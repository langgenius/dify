import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { MembersClient } from '@/api/members'
import { LIMIT_DEFAULT, parseLimit } from '@/limit/limit'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'
import { MemberListOutput, MemberRow } from './handlers.js'

export type GetMemberOptions = {
  readonly workspace?: string
  readonly page?: number
  readonly limitRaw?: string
  readonly format?: string
}

export type GetMemberDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: HttpClient) => MembersClient
}

export type GetMemberResult = {
  readonly data: MemberListOutput
  readonly workspaceId: string
}

export async function runGetMember(
  opts: GetMemberOptions,
  deps: GetMemberDeps,
): Promise<GetMemberResult> {
  const env = deps.envLookup ?? ((k: string) => process.env[k])
  const factory = deps.membersFactory ?? ((h: HttpClient) => new MembersClient(h))
  const io = deps.io ?? nullStreams()

  const wsId = resolveWorkspaceId({
    flag: opts.workspace,
    env: env('DIFY_WORKSPACE_ID'),
    active: deps.active,
  })

  const limit = resolveLimit(opts.limitRaw, env)
  const page = opts.page === undefined || opts.page <= 0 ? 1 : opts.page

  const envelope = await runWithSpinner(
    { io, label: 'Fetching members' },
    () => factory(deps.http).list(wsId, { page, limit }),
  )

  const callerId = deps.active.ctx.account?.id ?? ''
  const rows = envelope.data.map(m => new MemberRow(m, callerId !== '' && m.id === callerId))
  return { data: new MemberListOutput(rows, envelope), workspaceId: wsId }
}

function resolveLimit(raw: string | undefined, env: (k: string) => string | undefined): number {
  if (raw !== undefined && raw !== '')
    return parseLimit(raw, '--limit')
  const envValue = env('DIFY_LIMIT')
  if (envValue !== undefined && envValue !== '')
    return parseLimit(envValue, 'DIFY_LIMIT')
  return LIMIT_DEFAULT
}
