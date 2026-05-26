import { Flags } from '../../../framework/flags.js'
import { raw } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runEnvList } from './run-list.js'

export default class EnvList extends DifyCommand {
  static override description = 'Show every DIFY_* env var difyctl reads'

  static override examples = [
    '<%= config.bin %> env list',
    '<%= config.bin %> env list --json',
  ]

  static override flags = {
    json: Flags.boolean({ description: 'emit JSON', default: false }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(EnvList, argv)
    return raw(runEnvList({ json: flags.json }))
  }
}
