import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { AppInfoCache } from '../../../cache/app-info.js'
import type { IOStreams } from '../../../io/streams.js'
import { AppMetaClient } from '../../../api/app-meta.js'
import { AppsClient } from '../../../api/apps.js'
import { runWithSpinner } from '../../../io/spinner.js'
import { nullStreams } from '../../../io/streams.js'
import { FieldInfo, FieldInputSchema, FieldParameters } from '../../../types/app-meta.js'
import { resolveWorkspaceId } from '../../../workspace/resolver.js'
import { AppDescribeOutput } from './handlers.js'

export type DescribeAppOptions = {
  readonly appId: string
  readonly workspace?: string
  readonly format?: string
  readonly refresh?: boolean
}

export type DescribeAppDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly host: string
  readonly io?: IOStreams
  readonly cache?: AppInfoCache
  readonly envLookup?: (k: string) => string | undefined
}

export async function runDescribeApp(opts: DescribeAppOptions, deps: DescribeAppDeps): Promise<AppDescribeOutput> {
  const env = deps.envLookup ?? ((k: string) => process.env[k])
  const wsId = resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), bundle: deps.bundle })
  const apps = new AppsClient(deps.http)
  const meta = new AppMetaClient({ apps, host: deps.host, cache: deps.cache })
  const io = deps.io ?? nullStreams()
  const result = await runWithSpinner(
    { io, label: 'Fetching app details' },
    async () => {
      if (opts.refresh === true)
        await meta.invalidate(opts.appId)
      return meta.get(opts.appId, wsId, [FieldInfo, FieldParameters, FieldInputSchema])
    },
  )
  return new AppDescribeOutput(result)
}
