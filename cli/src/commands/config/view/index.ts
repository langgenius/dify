import { resolveConfigDir } from '../../../config/dir.js'
import { Flags } from '../../../framework/flags.js'
import { raw } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runConfigView } from './run.js'

export default class ConfigView extends DifyCommand {
  static override description = 'Print the resolved config'

  static override examples = [
    '<%= config.bin %> config view',
    '<%= config.bin %> config view --json',
  ]

  static override flags = {
    json: Flags.boolean({ description: 'emit JSON', default: false }),
  }

  async run() {
    const { flags } = await this.parse(ConfigView)
    return raw(await runConfigView({ dir: resolveConfigDir(), json: flags.json }))
  }
}
