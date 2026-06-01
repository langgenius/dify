import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Args, Flags } from '@/framework/flags'
import { OutputFormat } from '@/framework/output'
import { agentGuide } from './guide'
import { resumeApp } from './run'

export default class ResumeApp extends DifyCommand {
  static override description = 'Resume a paused workflow app after submitting a human input form'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> resume app app-1 ft-abc --workflow-run-id wf-run-1 --action submit --inputs \'{"name":"Alice"}\'',
    '<%= config.bin %> resume app app-1 ft-abc --workflow-run-id wf-run-1 --inputs-file form.json',
  ]

  static override args = {
    id: Args.string({ description: 'app id', required: true }),
    formToken: Args.string({ description: 'form token from the HITL pause JSON', required: true }),
  }

  static override flags = {
    'workflow-run-id': Flags.string({ description: 'workflow_run_id from the HITL pause JSON', required: true }),
    'action': Flags.string({ description: 'user action id (auto-selected when form has exactly one action)' }),
    'inputs': Flags.string({ description: 'Input variables as a JSON object, e.g. --inputs \'{"key":"value"}\'. Mutually exclusive with --inputs-file.' }),
    'inputs-file': Flags.string({ description: 'Path to a JSON file containing the inputs object. Mutually exclusive with --inputs.' }),
    'workspace': Flags.string({ description: 'workspace id override' }),
    'with-history': Flags.boolean({ description: 'Replay executed-node history before attaching to live stream.', default: false }),
    'stream': Flags.boolean({ description: 'Print output live as tokens/events arrive. Default: collect and print at end.', default: false }),
    'think': Flags.boolean({ description: 'Show model thinking/reasoning when available. Strips <think>...</think> blocks silently by default; with --think, thinking is printed to stderr.', default: false }),
    'output': Flags.outputFormat({ options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.TEXT], default: '' }),
    'http-retry': httpRetryFlag,
  }

  async run(argv: string[]): Promise<void> {
    const { args, flags } = this.parse(ResumeApp, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], withCache: true, format })

    await resumeApp(
      {
        appId: args.id,
        formToken: args.formToken,
        workflowRunId: flags['workflow-run-id'],
        action: flags.action,
        inputsJson: flags.inputs,
        inputsFile: flags['inputs-file'],
        format,
        workspace: flags.workspace,
        withHistory: flags['with-history'],
        stream: flags.stream,
        think: flags.think,
      },
      { active: ctx.active, http: ctx.http, host: ctx.host, io: ctx.io, cache: ctx.cache },
    )
  }

  override agentGuide(): string {
    return agentGuide
  }
}
