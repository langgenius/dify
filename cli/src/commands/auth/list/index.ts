import { Registry } from '@/auth/hosts'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { OutputFormat, table } from '@/framework/output'
import { runAuthList } from './list'

export default class AuthList extends DifyCommand {
  static override description = 'List all authenticated contexts (host + account pairs)'

  static override examples = [
    '<%= config.bin %> auth list',
    '<%= config.bin %> auth list -o json',
    '<%= config.bin %> auth list -o name',
  ]

  static override flags = {
    output: Flags.outputFormat({ options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.NAME], default: '' }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(AuthList, argv)
    const reg = Registry.load()
    const result = runAuthList(reg)
    return table({ format: flags.output, data: result })
  }
}
