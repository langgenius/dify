import type { Import } from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import fs from 'node:fs'
import { AppDslClient } from '@/api/app-dsl'
import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getEnv } from '@/sys/index'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'

export type ImportAppOptions = {
  readonly fromFile?: string
  readonly fromUrl?: string
  readonly workspace?: string
  readonly name?: string
  readonly description?: string
  readonly appId?: string
  readonly iconType?: string
  readonly icon?: string
  readonly iconBackground?: string
}

export type ImportAppDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (k: string) => string | undefined
  readonly dslFactory?: (http: HttpClient) => AppDslClient
}

export type ImportAppResult = {
  readonly result: Import
}

export async function runImportApp(opts: ImportAppOptions, deps: ImportAppDeps): Promise<ImportAppResult> {
  const env = deps.envLookup ?? getEnv
  const io = deps.io ?? nullStreams()
  const dslFactory = deps.dslFactory ?? ((h: HttpClient) => new AppDslClient(h))

  const workspaceId = resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), active: deps.active })
  const client = dslFactory(deps.http)

  if (opts.fromFile !== undefined && opts.fromUrl !== undefined)
    throw newError(ErrorCode.UsageInvalidFlag, '--from-file and --from-url are mutually exclusive')

  let mode: string
  let yamlContent: string | undefined
  let yamlUrl: string | undefined

  if (opts.fromFile !== undefined) {
    mode = 'yaml-content'
    try {
      yamlContent = fs.readFileSync(opts.fromFile, 'utf8')
    }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT')
        throw newError(ErrorCode.UsageInvalidFlag, `--from-file: file not found: ${opts.fromFile}`)
      throw err
    }
  }
  else if (opts.fromUrl !== undefined) {
    mode = 'yaml-url'
    yamlUrl = opts.fromUrl
  }
  else {
    throw newError(ErrorCode.UsageInvalidFlag, 'one of --from-file or --from-url is required')
  }

  let result = await runWithSpinner(
    { io, label: 'Importing app DSL' },
    () => client.importApp(workspaceId, {
      mode,
      yaml_content: yamlContent,
      yaml_url: yamlUrl,
      name: opts.name,
      description: opts.description,
      app_id: opts.appId,
      icon_type: opts.iconType,
      icon: opts.icon,
      icon_background: opts.iconBackground,
    }),
  )

  if (result.status === 'failed') {
    throw newError(
      ErrorCode.Server4xxOther,
      `Import failed: ${result.error !== '' ? result.error : 'unknown error'}`,
    )
  }

  // DSL version mismatch: the server needs an explicit acknowledgement before
  // finalising. Auto-confirm here so the user does not need a second command.
  if (result.status === 'pending') {
    io.err.write(`note: DSL version mismatch (imported ${result.imported_dsl_version ?? '?'}, current ${result.current_dsl_version ?? '?'}); confirming automatically\n`)
    result = await runWithSpinner(
      { io, label: 'Confirming import' },
      () => client.confirmImport(workspaceId, result.id),
    )
  }

  if (result.status === 'failed') {
    throw newError(
      ErrorCode.Server4xxOther,
      `Import failed after confirmation: ${result.error !== '' ? result.error : 'unknown error'}`,
    )
  }

  return { result }
}
