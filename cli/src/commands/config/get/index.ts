import { DifyCommand } from '@/commands/_shared/dify-command'
import { Args } from '@/framework/flags'
import { raw } from '@/framework/output'
import { getConfigurationStore } from '@/store/manager'
import { runConfigGet } from './run'

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
