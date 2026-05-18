import { loadHosts } from '../../../auth/hosts.js'
import { resolveConfigDir } from '../../../config/dir.js'
import { Flags } from '../../../framework/flags.js'
import { realStreams } from '../../../io/streams.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runStatus } from './status.js'

export default class Status extends DifyCommand {
  static override description = 'Show authentication status for the active host'

  static override examples = [
    '<%= config.bin %> auth status',
    '<%= config.bin %> auth status -v',
    '<%= config.bin %> auth status --json',
  ]

  static override flags = {
    verbose: Flags.boolean({ char: 'v', description: 'show account/workspace ids and storage mode', default: false }),
    json: Flags.boolean({ description: 'emit JSON', default: false }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = await this.parse(Status, argv)
    const configDir = resolveConfigDir()
    const bundle = await loadHosts(configDir)
    await runStatus({ io: realStreams(), bundle, verbose: flags.verbose, json: flags.json })
  }
}
