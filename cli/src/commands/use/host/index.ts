import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { realStreams } from '@/sys/io/streams'
import { runUseHost } from './use-host'

export default class UseHost extends DifyCommand {
  static override description = 'Switch the active Dify host'

  static override examples = [
    '<%= config.bin %> use host',
    '<%= config.bin %> use host --domain cloud.dify.ai',
  ]

  static override flags = {
    domain: Flags.string({
      description:
        'host domain to switch to, e.g. cloud.dify.ai (interactive picker shown when omitted in TTY)',
      default: '',
    }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(UseHost, argv)
    await runUseHost({ io: realStreams(), host: flags.domain !== '' ? flags.domain : undefined })
  }
}
