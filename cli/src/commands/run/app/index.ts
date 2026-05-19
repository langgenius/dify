import { Args, Flags } from '../../../framework/flags.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { agentGuide } from './guide.js'
import { runApp } from './run.js'

export default class RunApp extends DifyCommand {
  static override description = 'Run an app and print the response'

  static override examples = [
    '<%= config.bin %> run app app-1 "hello"',
    '<%= config.bin %> run app app-1 --inputs \'{"name":"world"}\'',
    '<%= config.bin %> run app app-1 --inputs-file inputs.json',
    '<%= config.bin %> run app app-1 --stream',
    '<%= config.bin %> run app app-1 -o json',
    '<%= config.bin %> run app app-1 --file doc=@./report.pdf',
    '<%= config.bin %> run app app-1 --file img=https://cdn.example.com/logo.png',
  ]

  static override args = {
    id: Args.string({ description: 'app id', required: true }),
    message: Args.string({ description: 'user message (chat/agent-chat/advanced-chat/completion)', required: false }),
  }

  static override flags = {
    'inputs': Flags.string({ description: 'Input variables as a JSON object, e.g. --inputs \'{"key":"value"}\'. Mutually exclusive with --inputs-file.' }),
    'inputs-file': Flags.string({ description: 'Path to a JSON file containing the inputs object. Mutually exclusive with --inputs.' }),
    'file': Flags.stringArray({ description: 'Named file input (--file key=@path, repeatable)', default: [] }),
    'conversation': Flags.string({ description: 'Resume a chat conversation by id' }),
    'workflow-id': Flags.string({ description: 'Pin to a specific published workflow version' }),
    'workspace': Flags.string({ description: 'Workspace id (overrides DIFY_WORKSPACE_ID and stored default)' }),
    'stream': Flags.boolean({ description: 'Print output live as tokens/events arrive (default: collect and print at end)', default: false }),
    'think': Flags.boolean({ description: 'Show model thinking/reasoning when available. Strips <think>...</think> blocks silently by default; with --think, thinking is printed to stderr.', default: false }),
    'http-retry': httpRetryFlag,
    'output': Flags.string({ char: 'o', description: 'Output format (json|yaml|text)', default: '' }),
  }

  async run(argv: string[]): Promise<void> {
    const { args, flags } = this.parse(RunApp, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], withCache: true, format })
    await runApp(
      {
        appId: args.id,
        message: args.message,
        inputsJson: flags.inputs,
        inputsFile: flags['inputs-file'],
        files: flags.file,
        conversationId: flags.conversation,
        workflowId: flags['workflow-id'],
        workspace: flags.workspace,
        format,
        stream: flags.stream,
        think: flags.think,
      },
      { bundle: ctx.bundle, http: ctx.http, host: ctx.host, io: ctx.io, cache: ctx.cache },
    )
  }

  override agentGuide(): string {
    return agentGuide
  }
}
