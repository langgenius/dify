import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { OutputFormat, raw, table } from '@/framework/output'
import { runGetWorkspace } from './run'

export default class GetWorkspace extends DifyCommand {
  static override description = 'List workspaces visible to the current bearer'

  static override examples = [
    '<%= config.bin %> get workspace',
    '<%= config.bin %> get workspace -o json',
    '<%= config.bin %> get workspace -o name',
  ]

  static override flags = {
    output: Flags.outputFormat({ options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.NAME, OutputFormat.WIDE], default: '' }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(GetWorkspace, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ format })
    const result = await runGetWorkspace({ format }, { active: ctx.active, http: ctx.http, io: ctx.io })
    if (result.kind === 'empty')
      return raw(result.message)
    return table({
      format,
      data: result.data,
    })
  }
}
