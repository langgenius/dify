import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Args } from '@/framework/flags'
import { runUseWorkspace } from './use'

export default class UseWorkspace extends DifyCommand {
  static override description = 'Switch the active workspace on the server (omit the id to pick interactively)'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> use workspace ws-abc123',
    '<%= config.bin %> use workspace',
  ]

  static override args = {
    workspaceId: Args.string({ description: 'workspace id to switch to (omit to pick interactively)', required: false }),
  }

  static override flags = {
    'http-retry': httpRetryFlag,
  }

  async run(argv: string[]): Promise<void> {
    const { args, flags } = this.parse(UseWorkspace, argv)
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'] })
    await runUseWorkspace({ workspaceId: args.workspaceId }, {
      reg: ctx.reg,
      active: ctx.active,
      http: ctx.http,
      io: ctx.io,
    })
  }
}
