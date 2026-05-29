import type { Registry } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../sys/io/streams'
import { notLoggedInError } from '../../../auth/hosts.js'

export type WhoamiOptions = {
  readonly io: IOStreams
  readonly reg: Registry | undefined
  readonly json?: boolean
}

export async function runWhoami(opts: WhoamiOptions): Promise<void> {
  const active = opts.reg?.resolveActive()
  if (active === undefined)
    throw notLoggedInError()

  const sub = active.ctx.external_subject
  if (sub !== undefined) {
    if (opts.json === true) {
      opts.io.out.write(`${JSON.stringify({ subject_type: 'external_sso', email: sub.email, issuer: sub.issuer })}\n`)
      return
    }
    opts.io.out.write(sub.issuer !== ''
      ? `${sub.email} (external SSO, issuer: ${sub.issuer})\n`
      : `${sub.email} (external SSO)\n`)
    return
  }

  const acc = active.ctx.account
  if (opts.json === true) {
    opts.io.out.write(`${JSON.stringify({ id: acc.id ?? '', email: acc.email, name: acc.name })}\n`)
    return
  }
  opts.io.out.write(acc.name !== '' ? `${acc.email} (${acc.name})\n` : `${acc.email}\n`)
}
