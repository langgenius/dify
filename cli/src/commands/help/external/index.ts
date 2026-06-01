import { DifyCommand } from '@/commands/_shared/dify-command'
import { raw } from '@/framework/output'
import { runHelpExternal } from './external'

export default class HelpExternal extends DifyCommand {
  static override description = 'Agent-onboarding text for external-SSO bearers (dfoe_)'

  static override examples = [
    '<%= config.bin %> help external',
  ]

  async run(argv: string[]) {
    this.parse(HelpExternal, argv)
    return raw(runHelpExternal())
  }
}
