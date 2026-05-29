import { Flags } from '../../../framework/flags.js'
import { realStreams } from '../../../sys/io/streams'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runUseAccount } from './use-account.js'

export default class UseAccount extends DifyCommand {
  static override description = 'Switch the active account on the current host'

  static override examples = [
    '<%= config.bin %> use account',
    '<%= config.bin %> use account --email bob@corp.com',
  ]

  static override flags = {
    email: Flags.string({ description: 'account email to switch to', default: '' }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(UseAccount, argv)
    await runUseAccount({ io: realStreams(), email: flags.email !== '' ? flags.email : undefined })
  }
}
