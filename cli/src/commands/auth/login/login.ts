import type { Clock } from './device-flow.js'
import type { CodeResponse, PollSuccess } from '@/api/oauth-device'
import type { AccountContext } from '@/auth/hosts'
import type { StorageMode } from '@/store/store'
import type { TokenStore } from '@/store/token-store'
import type { ParseResult } from '@/sys/io/prompt'
import type { IOStreams } from '@/sys/io/streams'
import type { BrowserEnv, BrowserOpener } from '@/util/browser'
import * as os from 'node:os'
import { DeviceFlowApi } from '@/api/oauth-device'
import { Registry } from '@/auth/hosts'
import { BaseError, isBaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { createHttpClient } from '@/http/client'
import { detectTokenStore } from '@/store/manager'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { promptText } from '@/sys/io/prompt'
import { startSpinner } from '@/sys/io/spinner'
import { decideOpen, OpenDecision, openUrl, realEnv } from '@/util/browser'
import { bareHost, DEFAULT_HOST, openAPIBase, resolveHost, validateVerificationURI } from '@/util/host'
import { awaitAuthorization, realClock } from './device-flow.js'

export type LoginOptions = {
  readonly io: IOStreams
  readonly host?: string
  readonly noBrowser?: boolean
  readonly insecure?: boolean
  readonly deviceLabel?: string
  readonly store?: { readonly store: TokenStore, readonly mode: StorageMode }
  readonly api?: DeviceFlowApi
  readonly browserEnv?: BrowserEnv
  readonly browserOpener?: BrowserOpener
  readonly clock?: Clock
}

export async function runLogin(opts: LoginOptions): Promise<Registry> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const insecure = opts.insecure ?? false

  const host = await resolveLoginHost(opts, insecure)
  const label = opts.deviceLabel ?? defaultDeviceLabel()

  const api = opts.api ?? new DeviceFlowApi(createHttpClient({ baseURL: openAPIBase(host) }))
  const code = await api.requestCode({ device_label: label })

  renderCodePrompt(opts.io.err, cs, code)
  validateVerificationURI(code.verification_uri, insecure)

  const env = opts.browserEnv ?? realEnv()
  const decision = decideOpen(env, opts.noBrowser ?? false)
  if (decision === OpenDecision.Auto) {
    const opener = opts.browserOpener ?? openUrl
    try {
      await opener(code.verification_uri)
    }
    catch (err) {
      opts.io.err.write(`${cs.warningIcon()} couldn't open browser (${(err as Error).message}); open the URL above manually\n`)
    }
  }
  else {
    opts.io.err.write(`${cs.warningIcon()} ${decision} — open the URL above manually\n`)
  }

  const spinner = startSpinner({ io: opts.io, label: 'Waiting for authorization', style: 'dify' })
  let success: PollSuccess
  try {
    success = await awaitAuthorization(api, code, { clock: opts.clock ?? realClock() })
  }
  finally {
    spinner.stop()
  }

  const storeBundle = opts.store ?? await detectTokenStore()
  const display = bareHost(host)
  const email = accountEmail(success)
  const ctx = contextFromSuccess(success)

  await storeBundle.store.write(display, email, success.token)

  const reg = await Registry.load()
  reg.token_storage = storeBundle.mode
  reg.activate(display, email, ctx)
  applyScheme(reg, display, host)
  await reg.save()

  renderLoggedIn(opts.io.out, cs, host, success)
  return reg
}

async function resolveLoginHost(opts: LoginOptions, insecure: boolean): Promise<string> {
  const raw = opts.host?.trim() ?? ''
  if (raw !== '')
    return resolveHost({ raw, insecure })
  if (!opts.io.isErrTTY) {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: '--host is required (no TTY)',
      hint: 'pass the host explicitly, e.g. \'difyctl auth login --host cloud.dify.ai\'',
    })
  }
  return promptHost(opts.io, insecure)
}

function makeHostParser(insecure: boolean): (raw: string) => ParseResult<string> {
  return (raw: string) => {
    try {
      return { ok: true, value: resolveHost({ raw, insecure }) }
    }
    catch (err) {
      if (isBaseError(err)) {
        const msg = err.hint !== undefined ? `${err.message} — ${err.hint}` : err.message
        return { ok: false, error: msg }
      }
      return { ok: false, error: String(err) }
    }
  }
}

async function promptHost(io: IOStreams, insecure: boolean): Promise<string> {
  return promptText<string>({
    io,
    label: 'Enter Dify host URL',
    hint: insecure ? 'e.g. https://cloud.dify.ai or http://localhost' : 'e.g. https://your-dify.com',
    default: DEFAULT_HOST,
    acceptAsDefault: raw => /^y(?:es)?$/i.test(raw.trim()),
    parse: makeHostParser(insecure),
  })
}

function defaultDeviceLabel(): string {
  const host = os.hostname()
  return `difyctl on ${host !== '' ? host : 'unknown-host'}`
}

function renderCodePrompt(w: NodeJS.WritableStream, cs: ReturnType<typeof colorScheme>, code: CodeResponse): void {
  w.write(`${cs.warningIcon()} Copy this one-time code: ${cs.bold(code.user_code)}\n`)
  w.write(`  Open: ${code.verification_uri}\n`)
}

function renderLoggedIn(w: NodeJS.WritableStream, cs: ReturnType<typeof colorScheme>, host: string, s: PollSuccess): void {
  const display = bareHost(host)
  if (s.account && s.account.email !== '') {
    w.write(`${cs.successIcon()} Logged in to ${display} as ${cs.bold(s.account.email)} (${s.account.name})\n`)
    const ws = findDefaultWorkspace(s)
    if (ws !== undefined)
      w.write(`  Workspace: ${ws.name}\n`)
    return
  }
  if (s.subject_email !== undefined && s.subject_email !== '') {
    if (s.subject_issuer !== undefined && s.subject_issuer !== '')
      w.write(`${cs.successIcon()} Logged in to ${display} as ${cs.bold(s.subject_email)} (external SSO, issuer: ${s.subject_issuer})\n`)
    else
      w.write(`${cs.successIcon()} Logged in to ${display} as ${cs.bold(s.subject_email)} (external SSO)\n`)
    return
  }
  w.write(`${cs.successIcon()} Logged in to ${display}\n`)
}

function findDefaultWorkspace(s: PollSuccess): { id: string, name: string, role: string } | undefined {
  if (s.default_workspace_id === undefined || s.default_workspace_id === '')
    return undefined
  return s.workspaces?.find(w => w.id === s.default_workspace_id)
}

function accountEmail(s: PollSuccess): string {
  const email = (s.account?.email ?? '') !== '' ? s.account!.email : (s.subject_email ?? '')
  if (email === '') {
    throw new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: 'account has no email; cannot store credential',
      hint: 'this Dify instance returned no email for the signed-in subject',
    })
  }
  return email
}

function contextFromSuccess(s: PollSuccess): AccountContext {
  const ctx: AccountContext = {
    account: s.account
      ? { id: s.account.id, email: s.account.email, name: s.account.name }
      : { id: '', email: '', name: '' },
    token_id: s.token_id,
  }
  if (s.subject_email !== undefined && s.subject_email !== ''
    && (!s.account || s.account.id === '')) {
    ctx.external_subject = { email: s.subject_email, issuer: s.subject_issuer ?? '' }
  }
  const def = findDefaultWorkspace(s)
  if (def !== undefined)
    ctx.workspace = def
  return ctx
}

function applyScheme(reg: Registry, display: string, host: string): void {
  try {
    const u = new URL(host)
    if (u.protocol !== 'https:')
      reg.setScheme(display, u.protocol.replace(':', ''))
  }
  catch { /* keep scheme unset */ }
}
