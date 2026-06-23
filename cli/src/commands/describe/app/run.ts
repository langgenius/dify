import type { ActiveContext } from '@/auth/hosts'
import type { AppInfoCache } from '@/cache/app-info'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { AppMetaClient } from '@/api/app-meta'
import { selectAppReader } from '@/api/app-reader'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { FieldInfo, FieldInputSchema, FieldParameters } from '@/types/app-meta'
import { AppDescribeOutput } from './handlers.js'

export type DescribeAppOptions = {
  readonly appId: string
  readonly workspace?: string
  readonly format?: string
  readonly refresh?: boolean
}

export type DescribeAppDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly host: string
  readonly io?: IOStreams
  readonly cache?: AppInfoCache
  readonly envLookup?: (k: string) => string | undefined
}

export async function runDescribeApp(opts: DescribeAppOptions, deps: DescribeAppDeps): Promise<AppDescribeOutput> {
  const apps = selectAppReader(deps.active, deps.http)
  const meta = new AppMetaClient({ apps, host: deps.host, cache: deps.cache })
  const io = deps.io ?? nullStreams()
  const result = await runWithSpinner(
    { io, label: 'Fetching app details' },
    async () => {
      if (opts.refresh === true)
        await meta.invalidate(opts.appId)
      return meta.get(opts.appId, [FieldInfo, FieldParameters, FieldInputSchema])
    },
  )
  return new AppDescribeOutput(result)
}
