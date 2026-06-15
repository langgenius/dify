import type { ActiveContext, Registry, Workspace } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { WorkspacesClient } from '@/api/workspaces'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { selectFromList } from '@/sys/io/select'
import { runWithSpinner } from '@/sys/io/spinner'

export type UseWorkspaceOptions = {
  readonly workspaceId?: string
}

export type UseWorkspaceDeps = {
  readonly reg: Registry
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io: IOStreams
  readonly workspacesFactory?: (http: HttpClient) => WorkspacesClient
}

/**
 * Switch the caller's active workspace.
 *
 * With an explicit id we switch directly; with no id we fetch the live
 * workspace list and let the caller pick one interactively (TTY only).
 *
 * The server-side switch is the source of truth: if POST
 * `/workspaces/<id>/switch` fails we abort before touching `hosts.yml`, so
 * local state never diverges from the server.
 */
export async function runUseWorkspace(
  opts: UseWorkspaceOptions,
  deps: UseWorkspaceDeps,
): Promise<Registry> {
  const cs = colorScheme(colorEnabled(deps.io.isErrTTY))
  const factory = deps.workspacesFactory ?? ((h: HttpClient) => new WorkspacesClient(h))
  const client = factory(deps.http)

  const argId = opts.workspaceId?.trim() ?? ''
  const id = argId !== '' ? argId : await pickWorkspaceId(client, deps)

  const detail = await runWithSpinner(
    { io: deps.io, label: `Switching to ${id}` },
    () => client.switch(id),
  )

  const nextCtx = {
    ...deps.active.ctx,
    workspace: { id: detail.id, name: detail.name, role: detail.role },
  }
  deps.reg.upsert(deps.active.host, deps.active.email, nextCtx)
  deps.reg.save()
  deps.io.out.write(`${cs.successIcon()} Switched to ${detail.name} (${detail.id})\n`)
  return deps.reg
}

async function pickWorkspaceId(client: WorkspacesClient, deps: UseWorkspaceDeps): Promise<string> {
  if (!deps.io.isErrTTY) {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: 'a workspace id is required (no TTY)',
      hint: 'pass the id: \'difyctl use workspace <id>\'',
    })
  }

  const list = await runWithSpinner(
    { io: deps.io, label: 'Loading workspaces' },
    () => client.list(),
  )
  const items = list.workspaces.map<Workspace>(w => ({ id: w.id, name: w.name, role: w.role }))
  if (items.length === 0) {
    throw new BaseError({
      code: ErrorCode.AccessDenied,
      message: 'no workspaces available to switch to',
    })
  }

  const activeId = deps.active.ctx.workspace?.id
  const picked = await selectFromList<Workspace>({
    io: deps.io,
    items,
    header: 'Select a workspace',
    render: w => `${w.id === activeId ? '* ' : '  '}${w.name} (${w.role})`,
  })
  return picked.id
}
