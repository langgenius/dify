import type { CodeResponse, PollSuccess } from '../../../api/oauth-device.js'
import type { HostsBundle, StorageMode, Workspace } from '../../../auth/hosts.js'
import type { TokenStore } from '../../../auth/store.js'
import type { IOStreams } from '../../../io/streams.js'
import type { BrowserEnv, BrowserOpener } from '../../../util/browser.js'
import type { Clock } from './device-flow.js'
import * as os from 'node:os'
import * as readline from 'node:readline'
import { DeviceFlowApi } from '../../../api/oauth-device.js'
import { saveHosts } from '../../../auth/hosts.js'
import { selectStore } from '../../../auth/store.js'
import { createClient } from '../../../http/client.js'
import { colorEnabled, colorScheme } from '../../../io/color.js'
import { decideOpen, OpenDecision, openUrl, realEnv } from '../../../util/browser.js'
import { bareHost, DEFAULT_HOST, resolveHost, validateVerificationURI } from '../../../util/host.js'
import { awaitAuthorization, realClock } from './device-flow.js'

export type LoginOptions = {
  readonly configDir: string
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

export async function runLogin(opts: LoginOptions): Promise<HostsBundle> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const insecure = opts.insecure ?? false

  const host = await resolveLoginHost(opts, insecure)
  const label = opts.deviceLabel ?? defaultDeviceLabel()

  const api = opts.api ?? new DeviceFlowApi(createClient({ host }))
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

  const success = await awaitAuthorization(api, code, { clock: opts.clock ?? realClock() })

  const storeBundle = opts.store ?? await selectStore({ configDir: opts.configDir })
  const bundle = bundleFromSuccess(host, success, storeBundle.mode)

  await storeBundle.store.put(bundle.current_host, accountKey(bundle), success.token)
  await saveHosts(opts.configDir, bundle)

  renderLoggedIn(opts.io.out, cs, host, success)
  return bundle
}

async function resolveLoginHost(opts: LoginOptions, insecure: boolean): Promise<string> {
  let raw = opts.host?.trim() ?? ''
  if (raw === '')
    raw = await promptHost(opts.io)
  return resolveHost({ raw, insecure })
}

async function promptHost(io: IOStreams): Promise<string> {
  io.err.write(`? Dify host [${DEFAULT_HOST}]: `)
  const rl = readline.createInterface({ input: io.in, output: io.err, terminal: false })
  try {
    const line: string = await new Promise(resolve => rl.once('line', resolve))
    return line.trim()
  }
  finally {
    rl.close()
  }
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
  if (s.account !== undefined && s.account.email !== '') {
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

function bundleFromSuccess(host: string, s: PollSuccess, mode: StorageMode): HostsBundle {
  const display = bareHost(host)
  let scheme: string | undefined
  try {
    const u = new URL(host)
    if (u.protocol !== 'https:')
      scheme = u.protocol.replace(':', '')
  }
  catch { /* keep undefined */ }

  const bundle: HostsBundle = {
    current_host: display,
    scheme,
    token_storage: mode,
    token_id: s.token_id,
    tokens: { bearer: s.token },
  }
  if (s.account !== undefined) {
    bundle.account = { id: s.account.id, email: s.account.email, name: s.account.name }
  }
  if (s.subject_email !== undefined && s.subject_email !== ''
    && (s.account === undefined || s.account.id === '')) {
    bundle.external_subject = {
      email: s.subject_email,
      issuer: s.subject_issuer ?? '',
    }
  }
  const def = findDefaultWorkspace(s)
  if (def !== undefined)
    bundle.workspace = def
  if (s.workspaces !== undefined && s.workspaces.length > 0) {
    bundle.available_workspaces = s.workspaces.map<Workspace>(w => ({
      id: w.id,
      name: w.name,
      role: w.role,
    }))
  }
  return bundle
}

function accountKey(b: HostsBundle): string {
  if (b.account?.id !== undefined && b.account.id !== '')
    return b.account.id
  if (b.external_subject?.email !== undefined && b.external_subject.email !== '')
    return b.external_subject.email
  return 'default'
}
