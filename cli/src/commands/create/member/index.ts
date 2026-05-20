import { Flags } from '../../../framework/flags.js'
import { formatted } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runCreateMember } from './run.js'

export default class CreateMember extends DifyCommand {
  static override description = 'Invite a member to the active (or specified) workspace by email'

  static override examples = [
    '<%= config.bin %> create member --email user@example.com --role normal',
    '<%= config.bin %> create member --email user@example.com --role admin -w ws-1',
    '<%= config.bin %> create member --email user@example.com --role normal -o json',
  ]

  static override flags = {
    'email': Flags.string({ description: 'invitee email address', required: true }),
    'role': Flags.string({
      description: 'role to assign (normal|admin); owner is not assignable here',
      required: true,
    }),
    'workspace': Flags.string({
      char: 'w',
      description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)',
    }),
    'http-retry': httpRetryFlag,
    'output': Flags.string({ char: 'o', description: 'output format (json|yaml|name|text)', default: '' }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(CreateMember, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runCreateMember(
      { email: flags.email, role: flags.role, workspace: flags.workspace, format },
      { bundle: ctx.bundle, http: ctx.http, io: ctx.io },
    )
    return formatted({ format, data: result.data })
  }
}
