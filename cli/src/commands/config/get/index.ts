import { resolveConfigDir } from '../../../config/dir.js'
import { Args } from '../../../framework/flags.js'
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

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGet)
    process.stdout.write(await runConfigGet({ dir: resolveConfigDir(), key: args.key }))
  }
}
