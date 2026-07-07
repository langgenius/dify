import type { IOStreams } from '@/sys/io/streams'
import { notLoggedInError, Registry } from '@/auth/hosts'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { selectFromList } from '@/sys/io/select'

export type UseHostOptions = {
  readonly io: IOStreams
  readonly host: string | undefined
}

type HostChoice = { host: string, accounts: number, active: boolean }

export async function runUseHost(opts: UseHostOptions): Promise<void> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const reg = await Registry.load()
  const hosts = Object.keys(reg.hosts)
  if (hosts.length === 0)
    throw notLoggedInError()

  const target = opts.host ?? await pickHost(opts, reg, hosts)
  if (!hosts.includes(target)) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `unknown host "${target}"; known hosts: ${hosts.join(', ')}`,
    })
  }

  reg.setHost(target)
  await reg.save()
  opts.io.out.write(`${cs.successIcon()} Active host is now ${target}\n`)
}

async function pickHost(opts: UseHostOptions, reg: Registry, hosts: readonly string[]): Promise<string> {
  if (!opts.io.isErrTTY) {
    throw new BaseError({
      code: ErrorCode.UsageMissingArg,
      message: `--domain is required (no TTY); known hosts: ${hosts.join(', ')}`,
    })
  }
  const choices: HostChoice[] = hosts.map(h => ({
    host: h,
    accounts: Object.keys(reg.hosts[h]?.accounts ?? {}).length,
    active: reg.current_host === h,
  }))
  const picked = await selectFromList<HostChoice>({
    io: opts.io,
    items: choices,
    header: 'Select a host',
    render: c => `${c.active ? '* ' : '  '}${c.host}  (${c.accounts} account${c.accounts === 1 ? '' : 's'})`,
  })
  return picked.host
}
