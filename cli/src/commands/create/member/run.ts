import type { KyInstance } from 'ky'
import type { HostsBundle } from '@/auth/hosts'
import type { IOStreams } from '@/sys/io/streams'
import { MembersClient } from '@/api/members'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'
import { InviteOutput } from './handlers'

export type CreateMemberOptions = {
  readonly email: string
  readonly role: string
  readonly workspace?: string
  readonly format?: string
}

export type CreateMemberDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: KyInstance) => MembersClient
}

export type CreateMemberResult = {
  readonly data: InviteOutput
  readonly workspaceId: string
}

// `owner` is intentionally absent — ownership transfer is console-only.
const ASSIGNABLE_ROLES = new Set(['normal', 'admin'])

export async function runCreateMember(
  opts: CreateMemberOptions,
  deps: CreateMemberDeps,
): Promise<CreateMemberResult> {
  if (opts.email === undefined || opts.email === '') {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: '--email is required',
    })
  }
  if (!ASSIGNABLE_ROLES.has(opts.role)) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `invalid --role "${opts.role}"`,
      hint: 'expected: normal | admin (ownership transfer is console-only)',
    })
  }

  const env = deps.envLookup ?? ((k: string) => process.env[k])
  const factory = deps.membersFactory ?? ((h: KyInstance) => new MembersClient(h))
  const io = deps.io ?? nullStreams()
  const cs = colorScheme(colorEnabled(io.isErrTTY))

  const wsId = resolveWorkspaceId({
    flag: opts.workspace,
    env: env('DIFY_WORKSPACE_ID'),
    bundle: deps.bundle,
  })

  const response = await runWithSpinner(
    { io, label: `Inviting ${opts.email}` },
    () => factory(deps.http).invite(wsId, {
      email: opts.email,
      role: opts.role as 'normal' | 'admin',
    }),
  )

  const textLine = `${cs.successIcon()} Invited ${response.email} as ${response.role}\n`
  return { data: new InviteOutput(response, textLine), workspaceId: wsId }
}
