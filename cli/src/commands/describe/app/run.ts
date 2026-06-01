import type { KyInstance } from 'ky'
import type { HostsBundle } from '@/auth/hosts'
import type { AppInfoCache } from '@/cache/app-info'
import type { IOStreams } from '@/sys/io/streams'
import { AppMetaClient } from '@/api/app-meta'
import { AppsClient } from '@/api/apps'
import { getEnv } from '@/sys/index'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { FieldInfo, FieldInputSchema, FieldParameters } from '@/types/app-meta'
import { resolveWorkspaceId } from '@/workspace/resolver'
import { AppDescribeOutput } from './handlers'

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
  const env = deps.envLookup ?? getEnv
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
