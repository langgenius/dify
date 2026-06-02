import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { WorkspacesClient } from '@/api/workspaces'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { WorkspaceListOutput, WorkspaceRow } from './handlers.js'

export const EMPTY_WORKSPACES_MESSAGE
  = 'No workspaces visible to this bearer (external-SSO subjects see empty data).\n'

export type GetWorkspaceOptions = {
  readonly format?: string
}

export type GetWorkspaceDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly workspacesFactory?: (http: HttpClient) => WorkspacesClient
}

export type GetWorkspaceResult
  = | { readonly kind: 'empty', readonly message: string }
    | { readonly kind: 'output', readonly data: WorkspaceListOutput }

export async function runGetWorkspace(opts: GetWorkspaceOptions, deps: GetWorkspaceDeps): Promise<GetWorkspaceResult> {
  const wsFactory = deps.workspacesFactory ?? ((h: HttpClient) => new WorkspacesClient(h))
  const io = deps.io ?? nullStreams()
  const env = await runWithSpinner(
    { io, label: 'Fetching workspaces' },
    () => wsFactory(deps.http).list(),
  )
  if (env.workspaces.length === 0)
    return { kind: 'empty', message: EMPTY_WORKSPACES_MESSAGE }
  const currentId = deps.active.ctx.workspace?.id ?? ''
  return {
    kind: 'output',
    data: new WorkspaceListOutput(env.workspaces.map(w => new WorkspaceRow(
      w.id,
      w.name,
      w.role,
      w.status,
      w.current || (currentId !== '' && w.id === currentId),
    )), env),
  }
}
