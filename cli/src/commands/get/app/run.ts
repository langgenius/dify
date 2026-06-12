import type { AppDescribeResponse, AppListResponse, AppMode } from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { AppsClient } from '@/api/apps'
import { WorkspacesClient } from '@/api/workspaces'
import { LIMIT_DEFAULT, parseLimit } from '@/limit/limit'
import { getEnv } from '@/sys/index'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'
import { AppListOutput, AppRow } from './handlers.js'

export type GetAppOptions = {
  readonly appId?: string
  readonly workspace?: string
  readonly allWorkspaces?: boolean
  readonly page?: number
  readonly limitRaw?: string
  readonly mode?: AppMode
  readonly name?: string
  readonly tag?: string
  readonly format?: string
}

export type GetAppDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly appsFactory?: (http: HttpClient) => AppsClient
  readonly workspacesFactory?: (http: HttpClient) => WorkspacesClient
}

const ALL_WORKSPACES_CONCURRENCY = 4

export type GetAppResult = {
  readonly data: AppListOutput
}

export async function runGetApp(opts: GetAppOptions, deps: GetAppDeps): Promise<GetAppResult> {
  const env = deps.envLookup ?? getEnv
  const appsFactory = deps.appsFactory ?? ((h: HttpClient) => new AppsClient(h))
  const wsFactory = deps.workspacesFactory ?? ((h: HttpClient) => new WorkspacesClient(h))

  const apps = appsFactory(deps.http)
  const pageSize = resolveLimit(opts.limitRaw, env)
  const page = opts.page === undefined || opts.page <= 0 ? 1 : opts.page
  const label = opts.appId !== undefined && opts.appId !== '' ? 'Fetching app' : 'Fetching apps'
  const io = deps.io ?? nullStreams()

  const envelope = await runWithSpinner(
    { io, label },
    async (): Promise<AppListResponse> => {
      if (opts.allWorkspaces === true) {
        const ws = wsFactory(deps.http)
        return runAllWorkspaces(apps, ws, opts, page, pageSize)
      }
      if (opts.appId !== undefined && opts.appId !== '') {
        const wsId = resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), active: deps.active })
        const wsName = workspaceNameForId(deps.active, wsId)
        const desc = await apps.describe(opts.appId, ['info'])
        return describeToEnvelope(desc, wsId, wsName)
      }
      const wsId = resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), active: deps.active })
      return apps.list({
        workspaceId: wsId,
        page,
        limit: pageSize,
        mode: opts.mode,
        name: opts.name,
        tag: opts.tag,
      })
    },
  )

  return {
    data: new AppListOutput(envelope.data.map(row => new AppRow(row)), envelope),
  }
}

function resolveLimit(raw: string | undefined, env: (k: string) => string | undefined): number {
  if (raw !== undefined && raw !== '')
    return parseLimit(raw, '--limit')
  const envValue = env('DIFY_LIMIT')
  if (envValue !== undefined && envValue !== '')
    return parseLimit(envValue, 'DIFY_LIMIT')
  return LIMIT_DEFAULT
}

function describeToEnvelope(desc: AppDescribeResponse, wsId: string, wsName: string): AppListResponse {
  if (desc.info === null || desc.info === undefined) {
    return { page: 1, limit: 1, total: 0, has_more: false, data: [] }
  }
  return {
    page: 1,
    limit: 1,
    total: 1,
    has_more: false,
    data: [{
      id: desc.info.id,
      name: desc.info.name,
      description: desc.info.description,
      mode: desc.info.mode as AppMode,
      tags: desc.info.tags,
      updated_at: desc.info.updated_at,
      created_by_name: desc.info.author === '' ? undefined : desc.info.author,
      workspace_id: wsId,
      workspace_name: wsName === '' ? undefined : wsName,
    }],
  }
}

function workspaceNameForId(active: ActiveContext, id: string): string {
  if (id === '')
    return ''
  return active.ctx.workspace?.id === id ? active.ctx.workspace.name : ''
}

async function runAllWorkspaces(
  apps: AppsClient,
  ws: WorkspacesClient,
  opts: GetAppOptions,
  page: number,
  limit: number,
): Promise<AppListResponse> {
  const wsResp = await ws.list()
  if (wsResp.workspaces.length === 0)
    return { page: 1, limit, total: 0, has_more: false, data: [] }

  const merged: AppListResponse = { page: 1, limit, total: 0, has_more: false, data: [] }
  const queue = [...wsResp.workspaces]
  const workers: Promise<void>[] = []

  const fetchOne = async (wsId: string): Promise<void> => {
    const env = await apps.list({
      workspaceId: wsId,
      page,
      limit,
      mode: opts.mode,
      name: opts.name,
      tag: opts.tag,
    })
    merged.total += env.total
    merged.data = [...merged.data, ...env.data]
  }

  const runner = async (): Promise<void> => {
    while (true) {
      const next = queue.shift()
      if (next === undefined)
        return
      await fetchOne(next.id)
    }
  }

  const N = Math.min(ALL_WORKSPACES_CONCURRENCY, wsResp.workspaces.length)
  for (let i = 0; i < N; i++) workers.push(runner())
  await Promise.all(workers)

  merged.data = [...merged.data].sort((a, b) => a.id.localeCompare(b.id))
  return merged
}
