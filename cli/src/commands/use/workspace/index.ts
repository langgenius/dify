import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Args } from '@/framework/flags'
import { runUseWorkspace } from './use'

export default class UseWorkspace extends DifyCommand {
  static override description = 'Switch the active workspace on the server and refresh hosts.yml'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> use workspace ws-abc123',
  ]

  static override args = {
    workspaceId: Args.string({ description: 'workspace id to switch to', required: true }),
  }

  async run(argv: string[]): Promise<void> {
    const { args } = this.parse(UseWorkspace, argv)
    const ctx = await this.authedCtx({})
    await runUseWorkspace({ workspaceId: args.workspaceId }, {
      reg: ctx.reg,
      active: ctx.active,
      http: ctx.http,
      io: ctx.io,
    })
  }
}
