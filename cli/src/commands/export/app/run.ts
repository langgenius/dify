import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import fs from 'node:fs'
import { dirname } from 'node:path'
import { AppDslClient } from '@/api/app-dsl'
import { getEnv } from '@/sys/index'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'

export type ExportAppOptions = {
  readonly appId: string
  readonly workspace?: string
  readonly output?: string
  readonly includeSecret?: boolean
  readonly workflowId?: string
}

export type ExportAppDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly dslFactory?: (http: HttpClient) => AppDslClient
}

export type ExportAppResult = {
  readonly yaml: string
  readonly writtenTo: string | undefined
}

export async function runExportApp(opts: ExportAppOptions, deps: ExportAppDeps): Promise<ExportAppResult> {
  const env = deps.envLookup ?? getEnv
  const io = deps.io ?? nullStreams()
  const dslFactory = deps.dslFactory ?? ((h: HttpClient) => new AppDslClient(h))

  // workspace is needed to satisfy the auth pipeline; resolving it here
  // mirrors what other commands do even though the export endpoint does not
  // take workspace_id as a query parameter (it loads tenant from app).
  resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), active: deps.active })

  const client = dslFactory(deps.http)

  const yaml = await runWithSpinner(
    { io, label: `Exporting DSL for app ${opts.appId}` },
    () => client.exportDsl(opts.appId, {
      includeSecret: opts.includeSecret,
      workflowId: opts.workflowId,
    }),
  )

  if (opts.output !== undefined && opts.output !== '') {
    fs.mkdirSync(dirname(opts.output), { recursive: true })
    fs.writeFileSync(opts.output, yaml, 'utf8')
    io.err.write(`DSL written to ${opts.output}\n`)
    return { yaml, writtenTo: opts.output }
  }

  return { yaml, writtenTo: undefined }
}
