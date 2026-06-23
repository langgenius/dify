import type { CommandEffect } from '@/framework/command'
import type { HttpClient } from '@/http/types'
import { Registry } from '@/auth/hosts'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { createHttpClient } from '@/http/client'
import { getTokenStore } from '@/store/manager'
import { runWithSpinner } from '@/sys/io/spinner'
import { realStreams } from '@/sys/io/streams'
import { hostWithScheme, openAPIBase } from '@/util/host'
import { runLogout } from './logout.js'

export default class Logout extends DifyCommand {
  static override description = 'Log out of the active Dify host'

  static override effect: CommandEffect = 'write'

  static override examples = [
    '<%= config.bin %> auth logout',
  ]

  async run(argv: string[]): Promise<void> {
    this.parse(Logout, argv)
    const io = realStreams()
    const reg = await Registry.load()
    const active = reg.resolveActive()

    let http: HttpClient | undefined
    if (active !== undefined) {
      let bearer = ''
      try {
        bearer = await getTokenStore(reg.token_storage).read(active.host, active.email)
      }
      catch { /* keyring locked — skip remote revocation, local cleanup still runs */ }
      if (bearer !== '') {
        http = createHttpClient({ baseURL: openAPIBase(hostWithScheme(active.host, active.scheme)), bearer, retryAttempts: 0 })
      }
    }

    await runWithSpinner(
      { io, label: 'Signing out', enabled: true, style: 'dify-dim' },
      () => runLogout({ io, reg, http }),
    )
  }
}
