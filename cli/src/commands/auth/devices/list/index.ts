import { Flags } from '../../../../framework/flags.js'
import { DifyCommand } from '../../../_shared/dify-command.js'
import { httpRetryFlag } from '../../../_shared/global-flags.js'
import { runDevicesList } from '../_shared/devices.js'

export default class DevicesList extends DifyCommand {
  static override description = 'List active sessions for the current bearer'

  static override examples = [
    '<%= config.bin %> auth devices list',
    '<%= config.bin %> auth devices list --json',
  ]

  static override flags = {
    'http-retry': httpRetryFlag,
    'json': Flags.boolean({ description: 'emit JSON', default: false }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = await this.parse(DevicesList, argv)
    const format = flags.json ? 'json' : ''
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    await runDevicesList({ io: ctx.io, bundle: ctx.bundle, http: ctx.http, json: flags.json })
  }
}
