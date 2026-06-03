import { DifyCommand } from '@/commands/_shared/dify-command'
import { raw } from '@/framework/output'
import { runHelpAccount } from './account'

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
