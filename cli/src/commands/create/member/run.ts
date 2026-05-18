import type { MemberInviteResponse } from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../io/streams.js'
import { MembersClient } from '../../../api/members.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { colorEnabled, colorScheme } from '../../../io/color.js'
import { runWithSpinner } from '../../../io/spinner.js'
import { nullStreams } from '../../../io/streams.js'
import { resolveWorkspaceId } from '../../../workspace/resolver.js'

export type CreateMemberOptions = {
  readonly email: string
  readonly role: string
  readonly workspace?: string
}

export type CreateMemberDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: KyInstance) => MembersClient
}

// `owner` is intentionally absent — ownership transfer is console-only.
const ASSIGNABLE_ROLES = new Set(['normal', 'admin'])

export async function runCreateMember(
  opts: CreateMemberOptions,
  deps: CreateMemberDeps,
): Promise<MemberInviteResponse> {
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

  const result = await runWithSpinner(
    { io, label: `Inviting ${opts.email}` },
    () => factory(deps.http).invite(wsId, {
      email: opts.email,
      role: opts.role as 'normal' | 'admin',
    }),
  )

  io.out.write(`${cs.successIcon()} Invited ${result.email} as ${result.role}\n`)
  return result
}
