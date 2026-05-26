import { Args } from '../../../framework/flags.js'
import { raw } from '../../../framework/output.js'
import { getConfigurationStore } from '../../../store/manager.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runConfigGet } from './run.js'

export default class ConfigGet extends DifyCommand {
  static override description = 'Print one config key\'s value'

  static override examples = [
    '<%= config.bin %> config get defaults.format',
  ]

  static override args = {
    key: Args.string({ description: 'config key', required: true }),
  }

  async run(argv: string[]) {
    const { args } = this.parse(ConfigGet, argv)
    return raw(runConfigGet({ store: getConfigurationStore(), key: args.key }))
  }
}
