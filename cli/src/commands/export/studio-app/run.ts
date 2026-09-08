import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { dirname } from 'node:path'
import { AppDslClient } from '@/api/app-dsl'
import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getEnv } from '@/sys/index'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'

export type ExportAppOptions = {
  readonly appId: string
  readonly workspace?: string
  readonly output?: string
  readonly includeSecret?: boolean
  readonly includeWorkflowTools?: boolean
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

export async function runExportApp(
  opts: ExportAppOptions,
  deps: ExportAppDeps,
): Promise<ExportAppResult> {
  const env = deps.envLookup ?? getEnv
  const io = deps.io ?? nullStreams()
  const dslFactory = deps.dslFactory ?? ((h: HttpClient) => new AppDslClient(h))

  // workspace is resolved to satisfy the auth pipeline; the export endpoint itself
  // takes no workspace_id query parameter (it loads tenant from the app).
  resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), active: deps.active })

  const client = dslFactory(deps.http)

  const response = await runWithSpinner({ io, label: `Exporting DSL for app ${opts.appId}` }, () =>
    client.exportDsl(opts.appId, {
      includeSecret: opts.includeSecret,
      includeWorkflowTools: opts.includeWorkflowTools,
      workflowId: opts.workflowId,
    }),
  )

  const yaml = response.data
  if (response.format === 'zip' && !opts.output)
    throw newError(
      ErrorCode.UsageInvalidFlag,
      'exporting a workflow bundle requires --output <file.zip>',
    )

  if (opts.output !== undefined && opts.output !== '') {
    fs.mkdirSync(dirname(opts.output), { recursive: true })
    fs.writeFileSync(opts.output, response.format === 'zip' ? Buffer.from(yaml, 'base64') : yaml)
    io.err.write(`DSL written to ${opts.output}\n`)
    return { yaml, writtenTo: opts.output }
  }

  return { yaml, writtenTo: undefined }
}
