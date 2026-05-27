import { Args } from '../../../framework/flags.js'
import { raw } from '../../../framework/output.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runConfigSet } from './run.js'

export default class ConfigSet extends DifyCommand {
  static override description = 'Set a config key (validates value)'

  static override examples = [
    '<%= config.bin %> config set defaults.format json',
    '<%= config.bin %> config set defaults.limit 50',
  ]

  static override args = {
    key: Args.string({ description: 'config key', required: true }),
    value: Args.string({ description: 'config value', required: true }),
  }

  async run(argv: string[]) {
    const { args } = this.parse(ConfigSet, argv)
    return raw(runConfigSet({ store: getConfigurationStore(), key: args.key, value: args.value }))
  }
}
