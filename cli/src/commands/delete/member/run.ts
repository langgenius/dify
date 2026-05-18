import type { MemberActionResponse } from '@dify/contracts/api/openapi/types.gen'
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

export type DeleteMemberOptions = {
  readonly memberId: string
  readonly workspace?: string
}

export type DeleteMemberDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: KyInstance) => MembersClient
}

export async function runDeleteMember(
  opts: DeleteMemberOptions,
  deps: DeleteMemberDeps,
): Promise<MemberActionResponse> {
  if (opts.memberId === undefined || opts.memberId === '') {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: 'member id is required',
      hint: 'pass it positionally: difyctl delete member <member-id>',
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
    { io, label: `Removing ${opts.memberId}` },
    () => factory(deps.http).remove(wsId, opts.memberId),
  )

  io.out.write(`${cs.successIcon()} Removed ${opts.memberId}\n`)
  return result
}
