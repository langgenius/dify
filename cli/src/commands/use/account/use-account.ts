import type { HostEntry } from '@/auth/hosts'
import type { TokenStore } from '@/store/token-store'
import type { IOStreams } from '@/sys/io/streams'
import { notLoggedInError, Registry } from '@/auth/hosts'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getTokenStore } from '@/store/manager'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { selectFromList } from '@/sys/io/select'

export type UseAccountOptions = {
  readonly io: IOStreams
  readonly email: string | undefined
  /** Optional override for tests; production resolves via `getTokenStore`. */
  readonly store?: TokenStore
}

type AccountChoice = { email: string; name: string; sso: boolean; active: boolean }

const USE_HOST_HINT = "run 'difyctl use host' or 'difyctl auth login'"

export async function runUseAccount(opts: UseAccountOptions): Promise<void> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const reg = await Registry.load()
  if (reg.current_host === undefined) throw notLoggedInError(USE_HOST_HINT)
  const host = reg.current_host
  const entry = reg.hosts[host]
  if (entry === undefined) throw notLoggedInError(USE_HOST_HINT)

  const emails = Object.keys(entry.accounts)
  const target = opts.email ?? (await pickAccount(opts, entry, host))
  if (!emails.includes(target)) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `unknown account "${target}" on ${host}; known: ${emails.join(', ')}`,
    })
  }

  const store = opts.store ?? getTokenStore(reg.token_storage)
  if ((await store.read(host, target)) === '') {
    throw new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: `no credential stored for ${target} on ${host}`,
      hint: `run 'difyctl auth login --host ${host}'`,
    })
  }

  reg.setAccount(target)
  await reg.save()
  opts.io.out.write(`${cs.successIcon()} Active account on ${host} is now ${target}\n`)
}

async function pickAccount(
  opts: UseAccountOptions,
  entry: HostEntry,
  host: string,
): Promise<string> {
  const emails = Object.keys(entry.accounts)
  if (!opts.io.isErrTTY) {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: `--email is required (no TTY); known accounts on ${host}: ${emails.join(', ')}`,
    })
  }
  const choices: AccountChoice[] = Object.entries(entry.accounts).map(([email, ctx]) => ({
    email,
    name: ctx.account.name,
    sso: ctx.external_subject !== undefined,
    active: entry.current_account === email,
  }))
  const picked = await selectFromList<AccountChoice>({
    io: opts.io,
    items: choices,
    header: `Select an account on ${host}`,
    render: (c) =>
      `${c.active ? '* ' : '  '}${c.email}  ${c.sso ? '(SSO)' : c.name !== '' ? `(${c.name})` : ''}`.trimEnd(),
  })
  return picked.email
}
