import type { ActiveContext } from '@/auth/hosts'
import type { AppInfoCache } from '@/cache/app-info'
import type { RunContext } from '@/commands/run/app/_strategies/index'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { AppMetaClient } from '@/api/app-meta'
import { selectAppReader } from '@/api/app-reader'
import { AppRunClient } from '@/api/app-run'
import { pickStrategy } from '@/commands/run/app/_strategies/index'
import { RUN_MODES } from '@/commands/run/app/handlers'
import { resolveInputs, TEXT_FORMATS } from '@/commands/run/app/input-flags'
import { processExit } from '@/sys/index'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { FieldInfo } from '@/types/app-meta'

export type ResumeAppOptions = {
  readonly appId: string
  readonly formToken: string
  readonly workflowRunId: string
  readonly action?: string
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly inputsJson?: string
  readonly inputsFile?: string
  readonly format?: string
  readonly workspace?: string
  readonly withHistory?: boolean
  readonly stream?: boolean
  readonly think?: boolean
}

export type ResumeAppDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly host: string
  readonly io: IOStreams
  readonly cache?: AppInfoCache
  readonly envLookup?: (k: string) => string | undefined
  readonly exit?: (code: number) => never
}

export async function resumeApp(opts: ResumeAppOptions, deps: ResumeAppDeps): Promise<void> {
  const apps = selectAppReader(deps.active, deps.http)
  const meta = new AppMetaClient({ apps, host: deps.host, cache: deps.cache })
  const m = await meta.get(opts.appId, [FieldInfo])
  const mode = m.info?.mode ?? RUN_MODES.Workflow

  const runClient = new AppRunClient(deps.http)
  const exit = deps.exit ?? processExit

  let action = opts.action
  if (action === undefined) {
    const formResp = await deps.http.get<{ user_actions: { id: string }[] }>(
      `apps/${encodeURIComponent(opts.appId)}/form/human_input/${encodeURIComponent(opts.formToken)}`,
    )
    if (formResp.user_actions.length === 1) {
      action = formResp.user_actions[0]?.id ?? ''
    }
    else if (formResp.user_actions.length === 0) {
      action = ''
    }
    else {
      throw new Error('--action required: form has multiple user actions')
    }
  }

  const inputs = await resolveInputs(opts.inputsJson, opts.inputsFile, opts.inputs)
  await runClient.submitHumanInput(opts.appId, opts.formToken, action, inputs)

  const format = opts.format ?? ''
  const isText = TEXT_FORMATS.has(format)

  if (isText) {
    const cs = colorScheme(colorEnabled(deps.io.isErrTTY))
    deps.io.err.write(`${cs.successIcon()} ${cs.bold('form submitted')}\n`)
    deps.io.err.write(`  ${cs.dim('workflow execution resumed')}\n`)
  }
  const livePrint = opts.stream === true

  const adaptedRunClient = {
    runStream: (_appId: string, _body: unknown, streamOpts?: { signal?: AbortSignal }) =>
      runClient.reconnectStream(opts.appId, opts.workflowRunId, {
        signal: streamOpts?.signal,
        includeStateSnapshot: opts.withHistory === true,
      }),
    stopTask: (appId: string, taskId: string) => runClient.stopTask(appId, taskId),
    submitHumanInput: runClient.submitHumanInput.bind(runClient),
    reconnectStream: runClient.reconnectStream.bind(runClient),
  }

  const runCtx: RunContext = {
    opts: {
      appId: opts.appId,
      inputs: inputs as Record<string, unknown>,
      conversationId: undefined,
      workflowId: undefined,
      workspace: opts.workspace,
      format,
      stream: opts.stream,
      think: opts.think,
    },
    deps,
    mode,
    format,
    isText,
    livePrint,
    runClient: adaptedRunClient as unknown as AppRunClient,
    exit,
    think: opts.think ?? false,
  }

  await pickStrategy(isText, livePrint).execute(runCtx)

  if (isText) {
    const cs = colorScheme(colorEnabled(deps.io.isErrTTY))
    deps.io.err.write(`${cs.successIcon()} ${cs.bold('workflow finished')}\n`)
  }
}
