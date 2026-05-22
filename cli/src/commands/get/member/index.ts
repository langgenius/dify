import { Flags } from '../../../framework/flags.js'
import { table } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runGetMember } from './run.js'

export default class GetMember extends DifyCommand {
  static override description = 'List members of the active (or specified) workspace'

  static override examples = [
    '<%= config.bin %> get member',
    '<%= config.bin %> get member -w ws-1',
    '<%= config.bin %> get member --page 2 --limit 50',
    '<%= config.bin %> get member -o json',
    '<%= config.bin %> get member -o name',
  ]

  static override flags = {
    'workspace': Flags.string({
      char: 'w',
      description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)',
    }),
    'page': Flags.integer({ description: 'page number', default: 1 }),
    'limit': Flags.string({ description: 'page size [1..200]' }),
    'http-retry': httpRetryFlag,
    'output': Flags.string({ char: 'o', description: 'output format (json|yaml|name|wide)', default: '' }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(GetMember, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runGetMember(
      {
        workspace: flags.workspace,
        page: flags.page,
        limitRaw: flags.limit,
        format,
      },
      { bundle: ctx.bundle, http: ctx.http, io: ctx.io },
    )
    return table({ format, data: result.data })
  }
}
