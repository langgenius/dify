import type { ActiveContext } from '@/auth/hosts'
import type { AppInfoCache } from '@/cache/app-info'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { AppMetaClient } from '@/api/app-meta'
import { AppRunClient } from '@/api/app-run'
import { AppsClient } from '@/api/apps'
import { FileUploadClient } from '@/api/file-upload'
import { pickStrategy } from '@/commands/run/app/_strategies/index'
import { BaseError, HttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { processExit } from '@/sys/index'
import { FieldInfo } from '@/types/app-meta'
import { resolveFileInputs } from './file-flags.js'
import { RUN_MODES } from './handlers.js'

export type RunAppOptions = {
  readonly appId: string
  readonly message?: string
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly inputsJson?: string
  readonly inputsFile?: string
  readonly files?: readonly string[]
  readonly conversationId?: string
  readonly workflowId?: string
  readonly workspace?: string
  readonly format?: string
  readonly stream?: boolean
  readonly think?: boolean
  readonly retryOnRateLimit?: boolean
}

export type RunAppDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
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
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs and --inputs-file are mutually exclusive' })
  if (inputsJson !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(inputsJson)
    }
    catch {
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs must be valid JSON' })
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs must be a JSON object' })
    return parsed as Record<string, unknown>
  }
  if (inputsFile !== undefined) {
    const { readFile } = await import('node:fs/promises')
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(inputsFile, 'utf8'))
    }
    catch {
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs-file must contain valid JSON' })
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: '--inputs-file must be a JSON object' })
    return parsed as Record<string, unknown>
  }
  return { ...(directInputs ?? {}) }
}

export async function runApp(opts: RunAppOptions, deps: RunAppDeps): Promise<void> {
  const apps = new AppsClient(deps.http)
  const meta = new AppMetaClient({ apps, host: deps.host, cache: deps.cache })

  try {
    await executeRun(opts, deps, meta)
  }
  catch (err) {
    if (err instanceof HttpClientError && err.httpStatus === 422) {
      await meta.invalidate(opts.appId)
      throw err.withHint('app metadata cache cleared — if the app was recently republished, run the command again')
    }
    throw err
  }
}

async function executeRun(
  opts: RunAppOptions,
  deps: RunAppDeps,
  meta: AppMetaClient,
): Promise<void> {
  const m = await meta.get(opts.appId, [FieldInfo])
  const mode = m.info?.mode ?? ''
  if (mode === '')
    throw new Error(`app ${opts.appId}: mode missing from /describe`)

  if (mode === RUN_MODES.Workflow && opts.message !== undefined && opts.message !== '') {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: 'workflow apps do not accept a positional message',
      hint: 'pass workflow inputs via --inputs \'{"key":"value"}\'',
    })
  }

  const inputs = await resolveInputs(opts.inputsJson, opts.inputsFile, opts.inputs)
  if (opts.files !== undefined && opts.files.length > 0) {
    const uploadClient = new FileUploadClient(deps.http)
    const fileInputs = await resolveFileInputs(
      opts.appId,
      opts.files,
      (appId, path) => uploadClient.upload(appId, path),
    )
    Object.assign(inputs, fileInputs)
  }
  const format = opts.format ?? ''
  const isText = TEXT_FORMATS.has(format)
  const livePrint = opts.stream === true
  const runClient = new AppRunClient(deps.http)

  const exit = deps.exit ?? processExit
  const ctx = { opts: { ...opts, inputs }, deps, mode, format, isText, livePrint, runClient, exit, think: opts.think ?? false }
  await pickStrategy(isText, livePrint).execute(ctx)
}
