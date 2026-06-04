import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Args } from '@/framework/flags'
import { raw } from '@/framework/output'
import { getConfigurationStore } from '@/store/manager'
import { runConfigSet } from './run'

export default class ConfigSet extends DifyCommand {
  static override description = 'Set a config key (validates value)'

  static override effect: CommandEffect = 'write'

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
