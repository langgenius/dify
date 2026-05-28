import { Flags } from '../../../framework/flags.js'
import { resolveConfigDir } from '../../../store/dir.js'
import { realStreams } from '../../../sys/io/streams'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runLogin } from './login.js'

export default class Login extends DifyCommand {
  static override description = 'Sign in to Dify via OAuth device flow'

  static override examples = [
    '<%= config.bin %> auth login',
    '<%= config.bin %> auth login --host https://cloud.dify.ai',
    '<%= config.bin %> auth login --no-browser',
  ]

  static override flags = {
    'host': Flags.string({
      description: 'Dify host URL',
      default: '',
    }),
    'no-browser': Flags.boolean({
      description: 'do not auto-open the browser',
      default: false,
    }),
    'insecure': Flags.boolean({
      description: 'allow http:// hosts (local-dev only)',
      default: false,
    }),
  }

  async run(argv: string[]): Promise<void> {
    const { flags } = this.parse(Login, argv)
    await runLogin({
      configDir: resolveConfigDir(),
      io: realStreams(),
      host: flags.host,
      noBrowser: flags['no-browser'],
      insecure: flags.insecure,
    })
  }
}
