import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Args } from '@/framework/flags'
import { raw } from '@/framework/output'
import { getConfigurationStore } from '@/store/manager'
import { runConfigUnset } from './run'

export default class ConfigUnset extends DifyCommand {
  static override description = 'Reset a config key to its zero value'

  static override effect: CommandEffect = 'write'

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
