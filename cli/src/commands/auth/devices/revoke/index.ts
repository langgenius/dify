import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { runDevicesRevoke } from '@/commands/auth/devices/_shared/devices'
import { Args, Flags } from '@/framework/flags'

export default class DevicesRevoke extends DifyCommand {
  static override description = 'Revoke one or all session devices'

  static override effect: CommandEffect = 'destructive'

  static override examples = [
    '<%= config.bin %> auth devices revoke "difyctl on laptop"',
    '<%= config.bin %> auth devices revoke --all',
  ]

  static override args = {
    target: Args.string({ description: 'device label / id to revoke', required: false }),
  }

  static override flags = {
    'all': Flags.boolean({ description: 'revoke every session except the current one', default: false }),
    'http-retry': httpRetryFlag,
    'yes': Flags.boolean({ description: 'skip confirmation prompt', default: false }),
  }

  async run(argv: string[]): Promise<void> {
    const { args, flags } = this.parse(DevicesRevoke, argv)
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'] })
    await runDevicesRevoke({
      io: ctx.io,
      reg: ctx.reg,
      active: ctx.active,
      store: ctx.store,
      http: ctx.http,
      target: args.target,
      all: flags.all,
      yes: flags.yes,
    })
  }
}
