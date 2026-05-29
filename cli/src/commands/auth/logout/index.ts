import type { KyInstance } from 'ky'
import { Registry } from '../../../auth/hosts.js'
import { createClient } from '../../../http/client.js'
import { getTokenStore, tokenKey } from '../../../store/manager.js'
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
    const io = realStreams()
    const reg = Registry.load()
    const active = reg?.resolveActive()

    let http: KyInstance | undefined
    if (active !== undefined) {
      const bearer = getTokenStore().store.get(tokenKey(active.host, active.email))
      if (bearer !== '') {
        http = createClient({ host: hostWithScheme(active.host, active.scheme), bearer, retryAttempts: 0 })
      }
    }

    await runWithSpinner(
      { io, label: 'Signing out', enabled: true, style: 'dify-dim' },
      () => runLogout({ io, reg, http }),
    )
  }
}
