import { raw } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runHelpAccount } from './account.js'

export default class HelpAccount extends DifyCommand {
  static override description = 'Agent-onboarding text for account bearers (dfoa_)'

  static override examples = [
    '<%= config.bin %> help account',
  ]

  async run(argv: string[]) {
    this.parse(HelpAccount, argv)
    return raw(runHelpAccount())
  }
}
