import { selectStore } from '../../../../auth/store.js'
import { Args, Flags } from '../../../../framework/flags.js'
import { DifyCommand } from '../../../_shared/dify-command.js'
import { httpRetryFlag } from '../../../_shared/global-flags.js'
import { runDevicesRevoke } from '../_shared/devices.js'

export default class DevicesRevoke extends DifyCommand {
  static override description = 'Revoke one or all session devices'

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
    const { store } = await selectStore({ configDir: ctx.configDir })
    await runDevicesRevoke({
      configDir: ctx.configDir,
      io: ctx.io,
      bundle: ctx.bundle,
      http: ctx.http,
      store,
      target: args.target,
      all: flags.all,
      yes: flags.yes,
    })
  }
}
