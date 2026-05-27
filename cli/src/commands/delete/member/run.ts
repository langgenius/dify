import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../sys/io/streams.js'
import * as readline from 'node:readline'
import { MembersClient } from '../../../api/members.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { colorEnabled, colorScheme } from '../../../sys/io/color.js'
import { runWithSpinner } from '../../../sys/io/spinner.js'
import { nullStreams } from '../../../sys/io/streams.js'
import { resolveWorkspaceId } from '../../../workspace/resolver.js'
import { DeleteMemberOutput } from './handlers.js'

export type DeleteMemberOptions = {
  readonly memberId: string
  readonly workspace?: string
  readonly format?: string
  readonly yes?: boolean
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

async function promptConfirm(io: IOStreams, message: string): Promise<boolean> {
  io.err.write(message)
  const rl = readline.createInterface({ input: io.in, output: io.err, terminal: false })
  try {
    const line: string = await new Promise(resolve => rl.once('line', resolve))
    return line.trim().toLowerCase() === 'y'
  }
  finally {
    rl.close()
  }
}
