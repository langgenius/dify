import { Flags } from '../../../../framework/flags.js'
import { DifyCommand } from '../../../_shared/dify-command.js'
import { httpRetryFlag } from '../../../_shared/global-flags.js'
import { runDevicesList } from '../_shared/devices.js'

export default class DevicesList extends DifyCommand {
  static override description = 'List active sessions for the current bearer'

  static override examples = [
    '<%= config.bin %> auth devices list',
    '<%= config.bin %> auth devices list --json',
    '<%= config.bin %> auth devices list --page 2 --limit 50',
  ]

  static override flags = {
    'http-retry': httpRetryFlag,
    'json': Flags.boolean({ description: 'emit JSON', default: false }),
    'page': Flags.integer({ description: 'page number', default: 1 }),
    'limit': Flags.string({ description: 'page size [1..200]' }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(DevicesList, argv)
    const format = flags.json ? 'json' : ''
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    await runDevicesList({
      io: ctx.io,
      bundle: ctx.bundle,
      http: ctx.http,
      json: flags.json,
      page: flags.page,
      limitRaw: flags.limit,
    })
  }
}
