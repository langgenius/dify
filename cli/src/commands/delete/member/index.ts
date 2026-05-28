import { Args, Flags } from '../../../framework/flags.js'
import { formatted } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runDeleteMember } from './run.js'

export default class DeleteMember extends DifyCommand {
  static override description = 'Remove a member from the active (or specified) workspace'

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
    'output': Flags.string({ char: 'o', description: 'output format (json|yaml|name|text)', default: '' }),
    'yes': Flags.boolean({ char: 'y', description: 'skip confirmation prompt', default: false }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(DeleteMember, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runDeleteMember(
      { memberId: args.memberId, workspace: flags.workspace, format, yes: flags.yes },
      { bundle: ctx.bundle, http: ctx.http, io: ctx.io },
    )
    return formatted({ format, data: result.data })
  }
}
