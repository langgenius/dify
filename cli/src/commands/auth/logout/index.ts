import type { KyInstance } from 'ky'
import { loadHosts } from '../../../auth/hosts.js'
import { selectStore } from '../../../auth/store.js'
import { createClient } from '../../../http/client.js'
import { resolveConfigDir } from '../../../store/dir.js'
import { runWithSpinner } from '../../../sys/io/spinner.js'
import { realStreams } from '../../../sys/io/streams'
import { hostWithScheme } from '../../../util/host.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runLogout } from './logout.js'

export default class Logout extends DifyCommand {
  static override description = 'Log out of the active Dify host'

  static override examples = [
    '<%= config.bin %> auth logout',
  ]

  async run(argv: string[]): Promise<void> {
    this.parse(Logout, argv)
    const configDir = resolveConfigDir()
    const bundle = await loadHosts(configDir)
    const { store } = await selectStore({ configDir })

    let http: KyInstance | undefined
    if (bundle !== undefined && bundle.current_host !== '' && bundle.tokens?.bearer !== undefined && bundle.tokens.bearer !== '') {
      http = createClient({
        host: hostWithScheme(bundle.current_host, bundle.scheme),
        bearer: bundle.tokens.bearer,
        retryAttempts: 0,
      })
    }

    const io = realStreams()
    await runWithSpinner(
      { io, label: 'Signing out', enabled: true, style: 'dify-dim' },
      () => runLogout({ configDir, io, bundle, http, store }),
    )
  }
}
