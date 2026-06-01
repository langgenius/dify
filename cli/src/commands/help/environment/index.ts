import { DifyCommand } from '@/commands/_shared/dify-command'
import { raw } from '@/framework/output'
import { runHelpEnvironment } from './environment'

export default class HelpEnvironment extends DifyCommand {
  static override description = 'Long-form documentation for every DIFY_* env var'

  static override examples = [
    '<%= config.bin %> help environment',
  ]

  async run(argv: string[]) {
    this.parse(HelpEnvironment, argv)
    return raw(runHelpEnvironment())
  }
}
