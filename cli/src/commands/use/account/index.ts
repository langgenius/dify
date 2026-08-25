import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { realStreams } from '@/sys/io/streams'
import { runUseAccount } from './use-account'

export default class UseAccount extends DifyCommand {
  static override description = 'Switch the active account on the current host'

  static override examples = [
    '<%= config.bin %> use account',
    '<%= config.bin %> use account --email bob@corp.com',
  ]

  static override flags = {
    email: Flags.string({
      description:
        'email of the account to switch to (interactive picker shown when omitted in TTY)',
      default: '',
    }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(UseAccount, argv)
    await runUseAccount({ io: realStreams(), email: flags.email !== '' ? flags.email : undefined })
  }
}
