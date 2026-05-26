import type { HostsBundle } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../io/streams.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'

export type StatusOptions = {
  readonly io: IOStreams
  readonly bundle: HostsBundle | undefined
  readonly verbose?: boolean
  readonly json?: boolean
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const bundle = opts.bundle
  if (bundle === undefined || bundle.current_host === '' || bundle.tokens?.bearer === undefined || bundle.tokens.bearer === '') {
    if (opts.json === true) {
      opts.io.out.write(`${JSON.stringify({ host: null, logged_in: false })}\n`)
    }
    else {
      opts.io.out.write('Not logged in. Run \'difyctl auth login\' to sign in.\n')
    }
    throw new BaseError({ code: ErrorCode.NotLoggedIn, message: 'not logged in' })
  }

  if (opts.json === true) {
    opts.io.out.write(`${renderJson(bundle)}\n`)
    return
  }
  opts.io.out.write(renderHuman(bundle, opts.verbose ?? false))
}

function renderHuman(b: HostsBundle, verbose: boolean): string {
  const lines: string[] = []
  if (!verbose) {
    if (b.external_subject !== undefined) {
      const sub = b.external_subject
      lines.push(sub.issuer !== ''
        ? `Logged in to ${b.current_host} as ${sub.email} (via ${sub.issuer})`
        : `Logged in to ${b.current_host} as ${sub.email} (via SSO)`)
      lines.push('  Scope: apps:run')
      return `${lines.join('\n')}\n`
    }
    const acc = b.account ?? { id: '', email: '', name: '' }
    lines.push(`Logged in to ${b.current_host} as ${acc.email} (${acc.name})`)
    if (b.workspace?.name !== undefined && b.workspace.name !== '')
      lines.push(`  Workspace: ${b.workspace.name}`)
    lines.push('  Session:   Dify account — full access')
    return `${lines.join('\n')}\n`
  }

  if (b.external_subject !== undefined) {
    const sub = b.external_subject
    lines.push(b.current_host)
    lines.push(sub.issuer !== ''
      ? `  Subject: ${sub.email} (external SSO, issuer: ${sub.issuer})`
      : `  Subject: ${sub.email} (external SSO)`)
    lines.push('  Session: External SSO — can run apps, cannot manage workspace resources (scope: apps:run)')
    lines.push(`  Storage: ${b.token_storage}`)
    return `${lines.join('\n')}\n`
  }
  const acc = b.account ?? { id: '', email: '', name: '' }
  lines.push(b.current_host)
  lines.push(`  Account:   ${acc.email} (${acc.name}, ${acc.id ?? ''})`)
  if (b.workspace?.id !== undefined && b.workspace.id !== '')
    lines.push(`  Workspace: ${b.workspace.name} (${b.workspace.id}, role: ${b.workspace.role})`)
  lines.push(`  Available: ${b.available_workspaces?.length ?? 0} workspaces`)
  lines.push('  Session:   Dify account — full access (scope: full)')
  lines.push(`  Storage:   ${b.token_storage}`)
  return `${lines.join('\n')}\n`
}

function renderJson(b: HostsBundle): string {
  const out: Record<string, unknown> = {
    host: b.current_host,
    logged_in: true,
    storage: b.token_storage,
  }
  if (b.external_subject !== undefined) {
    out.subject_type = 'external_sso'
    out.subject_email = b.external_subject.email
    out.subject_issuer = b.external_subject.issuer
  }
  else if (b.account !== undefined) {
    out.account = { id: b.account.id ?? '', email: b.account.email, name: b.account.name }
    if (b.workspace?.id !== undefined && b.workspace.id !== '') {
      out.workspace = { id: b.workspace.id, name: b.workspace.name, role: b.workspace.role }
    }
    out.available_workspaces_count = b.available_workspaces?.length ?? 0
  }
  return JSON.stringify(out, null, 2)
}
