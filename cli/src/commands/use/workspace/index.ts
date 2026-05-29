import { Args } from '../../../framework/flags.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runUseWorkspace } from './use.js'

export default class UseWorkspace extends DifyCommand {
  static override description = 'Switch the active workspace on the server and refresh hosts.yml'

  static override examples = [
    '<%= config.bin %> use workspace ws-abc123',
  ]

  static override args = {
    workspaceId: Args.string({ description: 'workspace id to switch to', required: true }),
  }

  static override flags = {
    'http-retry': httpRetryFlag,
  }

  async run(argv: string[]): Promise<void> {
    const { args, flags } = this.parse(UseWorkspace, argv)
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'] })
    await runUseWorkspace({ workspaceId: args.workspaceId }, {
      bundle: ctx.bundle,
      http: ctx.http,
      io: ctx.io,
    })
  }
}
