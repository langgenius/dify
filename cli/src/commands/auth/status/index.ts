import { loadHosts } from '@/auth/hosts'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { realStreams } from '@/sys/io/streams'
import { runStatus } from './status'

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
    const { flags } = this.parse(Status, argv)
    const bundle = loadHosts()
    await runStatus({ io: realStreams(), bundle, verbose: flags.verbose, json: flags.json })
  }
}
