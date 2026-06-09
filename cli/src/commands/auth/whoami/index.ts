import { Registry } from '@/auth/hosts'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { realStreams } from '@/sys/io/streams'
import { runWhoami } from './whoami'

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
    const reg = Registry.load()
    await runWhoami({ io: realStreams(), reg, json: flags.json })
  }
}
