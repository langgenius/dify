import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Args, Flags } from '@/framework/flags'
import { agentGuide } from './guide'
import { runExportApp } from './run'

export default class ExportStudioApp extends DifyCommand {
  static override description =
    "Export a studio app's DSL configuration as YAML or a ZIP with workflow tools"

  static override examples = [
    '<%= config.bin %> export studio-app <app-id>',
    '<%= config.bin %> export studio-app <app-id> --output ./my-app.yaml',
    '<%= config.bin %> export studio-app <app-id> --include-secret',
    '<%= config.bin %> export studio-app <app-id> --include-workflow-tools --output ./my-app.zip',
    '<%= config.bin %> export studio-app <app-id> --workflow-id <workflow-id>',
  ]

  static override args = {
    id: Args.string({ description: 'app ID to export', required: true }),
  }

  static override flags = {
    workspace: Flags.string({
      description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)',
    }),
    output: Flags.string({
      description: 'write YAML or ZIP to this file path (YAML prints to stdout if omitted)',
      char: 'o',
    }),
    'include-workflow-tools': Flags.boolean({
      description: 'package nested workflow tools in a ZIP (requires --output for bundles)',
      default: false,
    }),
    'include-secret': Flags.boolean({
      description: 'include encrypted secret values in the exported DSL',
      default: false,
    }),
    'workflow-id': Flags.string({
      description: 'export a specific workflow by ID (workflow apps only)',
    }),
    'http-retry': httpRetryFlag,
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(ExportStudioApp, argv)
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'] })
    const result = await runExportApp(
      {
        appId: args.id,
        workspace: flags.workspace,
        output: flags.output,
        includeSecret: flags['include-secret'],
        includeWorkflowTools: flags['include-workflow-tools'],
        workflowId: flags['workflow-id'],
      },
      { active: ctx.active, http: ctx.http, io: ctx.io },
    )

    if (result.writtenTo === undefined) {
      ctx.io.out.write(result.yaml)
      if (!result.yaml.endsWith('\n')) ctx.io.out.write('\n')
    }
  }

  override agentGuide(): string {
    return agentGuide
  }
}
