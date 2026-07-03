import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { MembersClient } from '@/api/members'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'
import { SetMemberOutput } from './handlers.js'

export type SetMemberOptions = {
  readonly memberId: string
  readonly role: string
  readonly workspace?: string
  readonly format?: string
}

export type SetMemberDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: HttpClient) => MembersClient
}

export type SetMemberResult = {
  readonly data: SetMemberOutput
  readonly workspaceId: string
}

const ASSIGNABLE_ROLES = new Set(['normal', 'admin'])

export async function runSetMember(
  opts: SetMemberOptions,
  deps: SetMemberDeps,
): Promise<SetMemberResult> {
  if (opts.memberId === undefined || opts.memberId === '') {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: 'member id is required',
      hint: 'pass it positionally: difyctl set member <member-id> --role <role>',
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
  const factory = deps.membersFactory ?? ((h: HttpClient) => new MembersClient(h))
  const io = deps.io ?? nullStreams()
  const cs = colorScheme(colorEnabled(io.isErrTTY))

  const wsId = resolveWorkspaceId({
    flag: opts.workspace,
    env: env('DIFY_WORKSPACE_ID'),
    active: deps.active,
  })

  await runWithSpinner(
    { io, label: `Updating role for ${opts.memberId}` },
    () => factory(deps.http).updateRole(wsId, opts.memberId, {
      role: opts.role as 'normal' | 'admin',
    }),
  )

  const role = opts.role as 'normal' | 'admin'
  const textLine = `${cs.successIcon()} Set ${opts.memberId} role to ${role}\n`
  return {
    data: new SetMemberOutput({ id: opts.memberId, role }, textLine),
    workspaceId: wsId,
  }
}
