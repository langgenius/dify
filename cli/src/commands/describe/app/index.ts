import { DifyCommand } from '@/commands/_shared/dify-command'
import { Args, Flags } from '@/framework/flags'
import { formatted, OutputFormat } from '@/framework/output'
import { agentGuide } from './guide'
import { runDescribeApp } from './run'

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
    workspace: Flags.string({ description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)' }),
    output: Flags.outputFormat({ options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.TEXT], default: '' }),
    refresh: Flags.boolean({ description: 'bypass app-info cache and fetch fresh', default: false }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(DescribeApp, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ withCache: true, format })
    return formatted({
      format,
      data: await runDescribeApp(
        { appId: args.id, workspace: flags.workspace, format, refresh: flags.refresh },
        { active: ctx.active, http: ctx.http, host: ctx.host, io: ctx.io, cache: ctx.cache },
      ),
    })
  }

  override agentGuide(): string {
    return agentGuide
  }
}
