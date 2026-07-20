import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Flags } from '@/framework/flags'
import { realStreams } from '@/sys/io/streams'
import { enforceDifyVersion } from '@/version/enforce'
import { agentGuide } from './guide'
import { runLogin } from './login'

export default class Login extends DifyCommand {
  static override description = 'Sign in to Dify via OAuth device flow'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> auth login',
    '<%= config.bin %> auth login --host https://cloud.dify.ai',
    '<%= config.bin %> auth login --no-browser',
  ]

  static override flags = {
    host: Flags.string({
      description: 'Dify host URL',
      default: '',
    }),
    'no-browser': Flags.boolean({
      description: 'do not auto-open the browser',
      default: false,
    }),
    insecure: Flags.boolean({
      description: 'allow http:// hosts and skip TLS certificate verification (local-dev only)',
      default: false,
    }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(Login, argv)
    await runLogin({
      io: realStreams(),
      host: flags.host,
      noBrowser: flags['no-browser'],
      insecure: flags.insecure,
      verifyServer: async (host) => {
        await enforceDifyVersion(host, { forceFresh: true, insecure: flags.insecure })
      },
    })
  }

  override agentGuide(): string {
    return agentGuide
  }
}
