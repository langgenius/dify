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
import { DeleteMemberOutput } from './handlers.js'

export type DeleteMemberOptions = {
  readonly memberId: string
  readonly workspace?: string
  readonly format?: string
}

export type DeleteMemberDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: KyInstance) => MembersClient
}

export type DeleteMemberResult = {
  readonly data: DeleteMemberOutput
  readonly workspaceId: string
}

export async function runDeleteMember(
  opts: DeleteMemberOptions,
  deps: DeleteMemberDeps,
): Promise<DeleteMemberResult> {
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

  await runWithSpinner(
    { io, label: `Removing ${opts.memberId}` },
    () => factory(deps.http).remove(wsId, opts.memberId),
  )

  const textLine = `${cs.successIcon()} Removed ${opts.memberId}\n`
  return {
    data: new DeleteMemberOutput(opts.memberId, textLine),
    workspaceId: wsId,
  }
}
