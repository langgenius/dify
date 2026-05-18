import { resolveConfigDir } from '../../../config/dir.js'
import { Args } from '../../../framework/flags.js'
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

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigSet)
    process.stdout.write(await runConfigSet({ dir: resolveConfigDir(), key: args.key, value: args.value }))
  }
}
