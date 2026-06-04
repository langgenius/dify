import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Args, Flags } from '@/framework/flags'
import { formatted, OutputFormat } from '@/framework/output'
import { runDeleteMember } from './run'

export default class DeleteMember extends DifyCommand {
  static override description = 'Remove a member from the active (or specified) workspace'

  static override effect: CommandEffect = 'destructive'

  static override examples = [
    '<%= config.bin %> delete member acct-1',
    '<%= config.bin %> delete member acct-1 -w ws-1',
    '<%= config.bin %> delete member acct-1 -o json',
  ]

  static override args = {
    memberId: Args.string({ description: 'account id of the member to remove', required: true }),
  }

  static override flags = {
    'workspace': Flags.string({
      char: 'w',
      description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)',
    }),
    'http-retry': httpRetryFlag,
    'output': Flags.outputFormat({ options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.NAME, OutputFormat.TEXT], default: '' }),
    'yes': Flags.boolean({ char: 'y', description: 'skip confirmation prompt', default: false }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(DeleteMember, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runDeleteMember(
      { memberId: args.memberId, workspace: flags.workspace, format, yes: flags.yes },
      { active: ctx.active, http: ctx.http, io: ctx.io },
    )
    return formatted({ format, data: result.data })
  }
}
