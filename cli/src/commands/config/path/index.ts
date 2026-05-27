import { raw } from '../../../framework/output.js'
import { resolveConfigDir } from '../../../store/dir.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runConfigPath } from './run.js'

export default class ConfigPath extends DifyCommand {
  static override description = 'Print the resolved config.yml path'

  static override examples = [
    '<%= config.bin %> config path',
  ]

  async run(argv: string[]) {
    this.parse(ConfigPath, argv)
    return raw(runConfigPath({ dir: resolveConfigDir() }))
  }
}
