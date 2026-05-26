import { loadHosts } from '../../../auth/hosts.js'
import { Flags } from '../../../framework/flags.js'
import { resolveConfigDir } from '../../../store/dir.js'
import { realStreams } from '../../../sys/io/streams'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runWhoami } from './whoami.js'

export default class Whoami extends DifyCommand {
  static override description = 'Print the active subject\'s identity'

  static override examples = [
    '<%= config.bin %> auth whoami',
    '<%= config.bin %> auth whoami --json',
  ]

  static override flags = {
    json: Flags.boolean({ description: 'emit JSON', default: false }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(Whoami, argv)
    const configDir = resolveConfigDir()
    const bundle = await loadHosts(configDir)
    await runWhoami({ io: realStreams(), bundle, json: flags.json })
  }
}
