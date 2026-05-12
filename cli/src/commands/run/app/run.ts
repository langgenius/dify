import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { AppInfoCache } from '../../../cache/app-info.js'
import type { IOStreams } from '../../../io/streams.js'
import { AppMetaClient } from '../../../api/app-meta.js'
import { AppRunClient } from '../../../api/app-run.js'
import { AppsClient } from '../../../api/apps.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { FieldInfo } from '../../../types/app-meta.js'
import { resolveWorkspaceId } from '../../../workspace/resolver.js'
import { pickStrategy } from './_strategies/index.js'
import { RUN_MODES } from './handlers.js'
import { AppRunPrintFlags } from './print-flags.js'

export type RunAppOptions = {
  readonly appId: string
  readonly message?: string
  readonly inputs?: Readonly<Record<string, string>>
  readonly conversationId?: string
  readonly workspace?: string
  readonly format?: string
  readonly stream?: boolean
  readonly streamSetExplicitly?: boolean
}

export type RunAppDeps = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly host: string
  readonly io: IOStreams
  readonly cache?: AppInfoCache
  readonly envLookup?: (k: string) => string | undefined
}

const TEXT_FORMATS = new Set(['', 'text'])

export async function runApp(opts: RunAppOptions, deps: RunAppDeps): Promise<void> {
  const env = deps.envLookup ?? ((k: string) => process.env[k])
  const wsId = resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), bundle: deps.bundle })
  const apps = new AppsClient(deps.http)
  const meta = new AppMetaClient({ apps, host: deps.host, cache: deps.cache })
  const m = await meta.get(opts.appId, wsId, [FieldInfo])
  const mode = m.info?.mode ?? ''
  if (mode === '')
    throw new Error(`app ${opts.appId}: mode missing from /describe`)

  if (mode === RUN_MODES.Workflow && opts.message !== undefined && opts.message !== '') {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: 'workflow apps do not accept a positional message',
      hint: 'pass workflow inputs via --input key=value (repeatable)',
    })
  }

  const isAgent = m.info?.is_agent === true || mode === RUN_MODES.AgentChat
  const useStream = opts.stream === true || isAgent
  if (isAgent && opts.streamSetExplicitly === true && opts.stream === false)
    deps.io.err.write('note: agent apps require streaming; output is collected before printing\n')

  const format = opts.format ?? ''
  const isText = TEXT_FORMATS.has(format)
  const runClient = new AppRunClient(deps.http)
  const printFlags = new AppRunPrintFlags()

  const ctx = { opts, deps, mode, isAgent, format, isText, runClient, printFlags }
  await pickStrategy(useStream, isText).execute(ctx)
}
