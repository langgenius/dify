import type { KyInstance } from 'ky'
import type { HostsBundle, Workspace } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../sys/io/streams.js'
import { WorkspacesClient } from '../../../api/workspaces.js'
import { saveHosts } from '../../../auth/hosts.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { colorEnabled, colorScheme } from '../../../sys/io/color.js'
import { runWithSpinner } from '../../../sys/io/spinner.js'

export type UseWorkspaceOptions = {
  readonly workspaceId: string
}

export type UseWorkspaceDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly io: IOStreams
  readonly workspacesFactory?: (http: KyInstance) => WorkspacesClient
}

/**
 * Switch the caller's active workspace.
 *
 * Strict ordering:
 *   1. POST /workspaces/<id>/switch — if this fails (403/404/etc.) we abort
 *      with no `hosts.yml` mutation, so local state never diverges from the
 *      server. Any fallback to a pure-local update is explicitly disallowed
 *      (see workspace-plan.md decision D4).
 *   2. GET /workspaces — refresh the membership list so `available_workspaces`
 *      stays in sync. Failure here also aborts; the server-side current has
 *      already moved, but the local file is left untouched. A follow-up
 *      `difyctl get workspace` will reconcile.
 *   3. Persist `workspace` + `available_workspaces` atomically via `saveHosts`.
 */
export async function runUseWorkspace(
  opts: UseWorkspaceOptions,
  deps: UseWorkspaceDeps,
): Promise<HostsBundle> {
  const cs = colorScheme(colorEnabled(deps.io.isErrTTY))
  const factory = deps.workspacesFactory ?? ((h: KyInstance) => new WorkspacesClient(h))
  const client = factory(deps.http)

  const detail = await runWithSpinner(
    { io: deps.io, label: `Switching to ${opts.workspaceId}` },
    () => client.switch(opts.workspaceId),
  )

  const list = await runWithSpinner(
    { io: deps.io, label: 'Refreshing workspaces' },
    () => client.list(),
  )

  const matched = list.workspaces.find(w => w.id === detail.id)
  if (matched === undefined) {
    throw new BaseError({
      code: ErrorCode.Unknown,
      message: `server returned switch=${detail.id} but it is not visible in /workspaces`,
      hint: 'try again or contact your workspace admin',
    })
  }

  const next: HostsBundle = {
    ...deps.bundle,
    workspace: { id: matched.id, name: matched.name, role: matched.role },
    available_workspaces: list.workspaces.map<Workspace>(w => ({
      id: w.id,
      name: w.name,
      role: w.role,
    })),
  }
  saveHosts(next)
  deps.io.out.write(`${cs.successIcon()} Switched to ${matched.name} (${matched.id})\n`)
  return next
}
