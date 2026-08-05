import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Args, Flags } from '@/framework/flags'
import { formatted, OutputFormat } from '@/framework/output'
import { runSetMember } from './run'

export default class SetMember extends DifyCommand {
  static override description = "Change a member's role in the active (or specified) workspace"

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> set member acct-1 --role admin',
    '<%= config.bin %> set member acct-1 --role normal -w ws-1',
    '<%= config.bin %> set member acct-1 --role admin -o json',
  ]

  static override args = {
    memberId: Args.string({ description: 'account id of the member to update', required: true }),
  }

  static override flags = {
    role: Flags.string({
      description: 'new role (normal|admin); owner is not assignable here',
      required: true,
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)',
    }),
    'http-retry': httpRetryFlag,
    output: Flags.outputFormat({
      options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.NAME, OutputFormat.TEXT],
      default: '',
    }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(SetMember, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runSetMember(
      { memberId: args.memberId, role: flags.role, workspace: flags.workspace, format },
      { active: ctx.active, http: ctx.http, io: ctx.io },
    )
    return formatted({ format, data: result.data })
  }
}
