import { Args } from '../../../framework/flags.js'
import { raw } from '../../../framework/output.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runConfigUnset } from './run.js'

export default class ConfigUnset extends DifyCommand {
  static override description = 'Reset a config key to its zero value'

  static override examples = [
    '<%= config.bin %> config unset defaults.format',
  ]

  static override args = {
    key: Args.string({ description: 'config key', required: true }),
  }

  async run(argv: string[]) {
    const { args } = this.parse(ConfigUnset, argv)
    return raw(runConfigUnset({ store: getConfigurationStore(), key: args.key }))
  }
}
