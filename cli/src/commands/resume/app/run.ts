import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { AppInfoCache } from '../../../cache/app-info.js'
import type { IOStreams } from '../../../sys/io/streams'
import type { RunContext } from '../../run/app/_strategies/index.js'
import { AppMetaClient } from '../../../api/app-meta.js'
import { AppRunClient } from '../../../api/app-run.js'
import { AppsClient } from '../../../api/apps.js'
import { getEnv, processExit } from '../../../sys/index.js'
import { colorEnabled, colorScheme } from '../../../sys/io/color.js'
import { FieldInfo } from '../../../types/app-meta.js'
import { resolveWorkspaceId } from '../../../workspace/resolver.js'
import { pickStrategy } from '../../run/app/_strategies/index.js'
import { RUN_MODES } from '../../run/app/handlers.js'
import { AppRunPrintFlags } from '../../run/app/print-flags.js'

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
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly host: string
  readonly io: IOStreams
  readonly cache?: AppInfoCache
  readonly envLookup?: (k: string) => string | undefined
  readonly exit?: (code: number) => never
}

const TEXT_FORMATS = new Set(['', 'text'])

async function resolveInputs(
  inputsJson: string | undefined,
  inputsFile: string | undefined,
  directInputs: Readonly<Record<string, unknown>> | undefined,
): Promise<Record<string, unknown>> {
  if (inputsJson !== undefined && inputsFile !== undefined)
    throw new Error('--inputs and --inputs-file are mutually exclusive')
  if (inputsJson !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(inputsJson)
    }
    catch {
      throw new Error('--inputs must be valid JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('--inputs must be a JSON object')
    return parsed as Record<string, unknown>
  }
  if (inputsFile !== undefined) {
    const { readFile } = await import('node:fs/promises')
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(inputsFile, 'utf8'))
    }
    catch {
      throw new Error('--inputs-file must contain valid JSON')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('--inputs-file must be a JSON object')
    return parsed as Record<string, unknown>
  }
  return { ...(directInputs ?? {}) }
}

export async function resumeApp(opts: ResumeAppOptions, deps: ResumeAppDeps): Promise<void> {
  const env = deps.envLookup ?? getEnv
  const wsId = resolveWorkspaceId({ flag: opts.workspace, env: env('DIFY_WORKSPACE_ID'), bundle: deps.bundle })

  const apps = new AppsClient(deps.http)
  const meta = new AppMetaClient({ apps, host: deps.host, cache: deps.cache })
  const m = await meta.get(opts.appId, wsId, [FieldInfo])
  const mode = m.info?.mode ?? RUN_MODES.Workflow

  const runClient = new AppRunClient(deps.http)
  const exit = deps.exit ?? processExit

  let action = opts.action
  if (action === undefined) {
    const formResp = await deps.http.get(
      `apps/${encodeURIComponent(opts.appId)}/form/human_input/${encodeURIComponent(opts.formToken)}`,
    ).json<{ user_actions: { id: string }[] }>()
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
  const printFlags = new AppRunPrintFlags()

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
    printFlags,
    exit,
    think: opts.think ?? false,
  }

  await pickStrategy(isText, livePrint).execute(runCtx)

  if (isText) {
    const cs = colorScheme(colorEnabled(deps.io.isErrTTY))
    deps.io.err.write(`${cs.successIcon()} ${cs.bold('workflow finished')}\n`)
  }
}
