import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { MembersClient } from '@/api/members'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { promptConfirm } from '@/sys/io/prompt'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'
import { DeleteMemberOutput } from './handlers.js'

export type DeleteMemberOptions = {
  readonly memberId: string
  readonly workspace?: string
  readonly format?: string
  readonly yes?: boolean
}

export type DeleteMemberDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly membersFactory?: (http: HttpClient) => MembersClient
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
  const factory = deps.membersFactory ?? ((h: HttpClient) => new MembersClient(h))
  const io = deps.io ?? nullStreams()
  const cs = colorScheme(colorEnabled(io.isErrTTY))

  const wsId = resolveWorkspaceId({
    flag: opts.workspace,
    env: env('DIFY_WORKSPACE_ID'),
    active: deps.active,
  })

  if (!opts.yes && io.isErrTTY) {
    const confirmed = await promptConfirm(io, `Remove member ${opts.memberId}? [y/N] `)
    if (!confirmed) {
      throw new BaseError({
        code: ErrorCode.UsageMissingArg,
        message: 'aborted by user',
        hint: 'pass --yes to skip confirmation',
      })
    }
  }

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
