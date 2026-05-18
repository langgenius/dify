import { Args, Flags } from '../../../framework/flags.js'
import { formatted } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runDescribeApp } from './run.js'

export default class DescribeApp extends DifyCommand {
  static override description = 'Describe a single app (kubectl-describe-style)'

  static override examples = [
    '<%= config.bin %> describe app app-1',
    '<%= config.bin %> describe app app-1 -o json',
    '<%= config.bin %> describe app app-1 --refresh',
  ]

  static override args = {
    id: Args.string({ description: 'app id', required: true }),
  }

  static override flags = {
    'workspace': Flags.string({ description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)' }),
    'http-retry': httpRetryFlag,
    'output': Flags.string({ char: 'o', description: 'output format (json|yaml|text)', default: '' }),
    'refresh': Flags.boolean({ description: 'bypass app-info cache and fetch fresh', default: false }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(DescribeApp, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], withCache: true, format })
    return formatted({
      format,
      data: await runDescribeApp(
        { appId: args.id, workspace: flags.workspace, format, refresh: flags.refresh },
        { bundle: ctx.bundle, http: ctx.http, host: ctx.host, io: ctx.io, cache: ctx.cache },
      ),
    })
  }
}
