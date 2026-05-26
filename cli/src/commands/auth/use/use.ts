import type { HostsBundle, Workspace } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../io/streams.js'
import { saveHosts } from '../../../auth/hosts.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { colorEnabled, colorScheme } from '../../../io/color.js'

export type UseOptions = {
  readonly configDir: string
  readonly io: IOStreams
  readonly bundle: HostsBundle | undefined
  readonly workspaceId: string
}

export async function runUse(opts: UseOptions): Promise<HostsBundle> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const b = opts.bundle
  if (b === undefined || b.tokens?.bearer === undefined || b.tokens.bearer === '') {
    throw new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: 'not logged in',
      hint: 'run \'difyctl auth login\'',
    })
  }
  if (b.external_subject !== undefined) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: 'workspace context unavailable for external SSO sessions',
      hint: 'external SSO subjects don\'t carry tenant memberships in difyctl',
    })
  }

  const found = (b.available_workspaces ?? []).find(w => w.id === opts.workspaceId)
  if (found === undefined) {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: `workspace "${opts.workspaceId}" not found in available_workspaces; run 'difyctl auth status' to list`,
    })
  }

  const next: HostsBundle = { ...b, workspace: pickWorkspace(found) }
  await saveHosts(opts.configDir, next)
  opts.io.out.write(`${cs.successIcon()} Switched to workspace ${found.name} (${found.id})\n`)
  return next
}

function pickWorkspace(w: Workspace): Workspace {
  return { id: w.id, name: w.name, role: w.role }
}
