import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../sys/io/streams.js'
import { MembersClient } from '../../../api/members.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { colorEnabled, colorScheme } from '../../../sys/io/color.js'
import { runWithSpinner } from '../../../sys/io/spinner.js'
import { nullStreams } from '../../../sys/io/streams.js'
import { resolveWorkspaceId } from '../../../workspace/resolver.js'
import { SetMemberOutput } from './handlers.js'

export type SetMemberOptions = {
  readonly memberId: string
  readonly role: string
  readonly workspace?: string
  readonly format?: string
}

export type SetMemberDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: KyInstance) => MembersClient
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
  const factory = deps.membersFactory ?? ((h: KyInstance) => new MembersClient(h))
  const io = deps.io ?? nullStreams()
  const cs = colorScheme(colorEnabled(io.isErrTTY))

  const wsId = resolveWorkspaceId({
    flag: opts.workspace,
    env: env('DIFY_WORKSPACE_ID'),
    bundle: deps.bundle,
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
