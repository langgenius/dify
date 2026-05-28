import type { HostsBundle } from '../../../auth/hosts.js'
import type { IOStreams } from '../../../io/streams.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'

export type WhoamiOptions = {
  readonly io: IOStreams
  readonly bundle: HostsBundle | undefined
  readonly json?: boolean
}

export async function runWhoami(opts: WhoamiOptions): Promise<void> {
  const b = opts.bundle
  if (b === undefined || b.tokens?.bearer === undefined || b.tokens.bearer === '') {
    throw new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: 'not logged in',
      hint: 'run \'difyctl auth login\'',
    })
  }

  if (b.external_subject !== undefined) {
    if (opts.json === true) {
      opts.io.out.write(`${JSON.stringify({
        subject_type: 'external_sso',
        email: b.external_subject.email,
        issuer: b.external_subject.issuer,
      })}\n`)
      return
    }
    const sub = b.external_subject
    opts.io.out.write(sub.issuer !== ''
      ? `${sub.email} (external SSO, issuer: ${sub.issuer})\n`
      : `${sub.email} (external SSO)\n`)
    return
  }

  const acc = b.account ?? { id: '', email: '', name: '' }
  if (opts.json === true) {
    opts.io.out.write(`${JSON.stringify({ id: acc.id ?? '', email: acc.email, name: acc.name })}\n`)
    return
  }
  opts.io.out.write(acc.name !== ''
    ? `${acc.email} (${acc.name})\n`
    : `${acc.email}\n`)
}
