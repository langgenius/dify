import type { AccountContext, Registry } from '@/auth/hosts'
import type { IOStreams } from '@/sys/io/streams'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export type StatusOptions = {
  readonly io: IOStreams
  readonly reg: Registry
  readonly verbose?: boolean
  readonly json?: boolean
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const reg = opts.reg
  const active = reg.resolveActive()
  if (active === undefined) {
    if (opts.json === true)
      opts.io.out.write(`${JSON.stringify({ host: null, logged_in: false })}\n`)
    else
      opts.io.out.write('Not logged in. Run \'difyctl auth login\' to sign in.\n')
    throw new BaseError({ code: ErrorCode.NotLoggedIn, message: 'not logged in' })
  }

  if (opts.json === true) {
    opts.io.out.write(`${renderJson(active.host, active.ctx, reg.token_storage)}\n`)
    return
  }
  opts.io.out.write(renderHuman(active.host, active.ctx, reg.token_storage, opts.verbose ?? false))
  if (opts.verbose === true)
    opts.io.out.write(renderContexts(reg))
}

function renderHuman(host: string, ctx: AccountContext, storage: string, verbose: boolean): string {
  const lines: string[] = []
  const sub = ctx.external_subject
  if (!verbose) {
    if (sub !== undefined) {
      lines.push(sub.issuer !== ''
        ? `Logged in to ${host} as ${sub.email} (via ${sub.issuer})`
        : `Logged in to ${host} as ${sub.email} (via SSO)`)
      lines.push('  Scope: apps:run')
      return `${lines.join('\n')}\n`
    }
    lines.push(`Logged in to ${host} as ${ctx.account.email} (${ctx.account.name})`)
    if (ctx.workspace?.name !== undefined && ctx.workspace.name !== '')
      lines.push(`  Workspace: ${ctx.workspace.name}`)
    lines.push('  Session:   Dify account — full access')
    return `${lines.join('\n')}\n`
  }
  if (sub !== undefined) {
    lines.push(host)
    lines.push(sub.issuer !== ''
      ? `  Subject: ${sub.email} (external SSO, issuer: ${sub.issuer})`
      : `  Subject: ${sub.email} (external SSO)`)
    lines.push('  Session: External SSO — can run apps, cannot manage workspace resources (scope: apps:run)')
    lines.push(`  Storage: ${storage}`)
    return `${lines.join('\n')}\n`
  }
  lines.push(host)
  lines.push(`  Account:   ${ctx.account.email} (${ctx.account.name}, ${ctx.account.id ?? ''})`)
  if (ctx.workspace?.id !== undefined && ctx.workspace.id !== '')
    lines.push(`  Workspace: ${ctx.workspace.name} (${ctx.workspace.id}, role: ${ctx.workspace.role})`)
  lines.push(`  Available: ${ctx.available_workspaces?.length ?? 0} workspaces`)
  lines.push('  Session:   Dify account — full access (scope: full)')
  lines.push(`  Storage:   ${storage}`)
  return `${lines.join('\n')}\n`
}

function renderContexts(reg: Registry): string {
  const lines = ['Contexts:']
  for (const [host, entry] of Object.entries(reg.hosts)) {
    for (const email of Object.keys(entry.accounts)) {
      const isActive = reg.current_host === host && entry.current_account === email
      lines.push(`  ${isActive ? '*' : ' '} ${host}  ${email}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function renderJson(host: string, ctx: AccountContext, storage: string): string {
  const out: Record<string, unknown> = { host, logged_in: true, storage }
  if (ctx.external_subject !== undefined) {
    out.subject_type = 'external_sso'
    out.subject_email = ctx.external_subject.email
    out.subject_issuer = ctx.external_subject.issuer
  }
  else {
    out.account = { id: ctx.account.id ?? '', email: ctx.account.email, name: ctx.account.name }
    if (ctx.workspace?.id !== undefined && ctx.workspace.id !== '')
      out.workspace = { id: ctx.workspace.id, name: ctx.workspace.name, role: ctx.workspace.role }
    out.available_workspaces_count = ctx.available_workspaces?.length ?? 0
  }
  return JSON.stringify(out, null, 2)
}
