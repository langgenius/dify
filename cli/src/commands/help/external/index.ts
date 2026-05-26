import { raw } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runHelpExternal } from './external.js'

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
