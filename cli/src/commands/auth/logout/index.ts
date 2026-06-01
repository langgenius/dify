import type { HttpClient } from '@/http/types'
import { loadHosts } from '@/auth/hosts'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { createHttpClient } from '@/http/client'
import { runWithSpinner } from '@/sys/io/spinner'
import { realStreams } from '@/sys/io/streams'
import { hostWithScheme, openAPIBase } from '@/util/host'
import { runLogout } from './logout.js'

export default class Logout extends DifyCommand {
  static override description = 'Log out of the active Dify host'

  static override examples = [
    '<%= config.bin %> auth logout',
  ]

  async run(argv: string[]): Promise<void> {
    this.parse(Logout, argv)
    const bundle = loadHosts()

    let http: HttpClient | undefined
    if (bundle !== undefined && bundle.current_host !== '' && bundle.tokens?.bearer !== undefined && bundle.tokens.bearer !== '') {
      http = createHttpClient({
        baseURL: openAPIBase(hostWithScheme(bundle.current_host, bundle.scheme)),
        bearer: bundle.tokens.bearer,
        retryAttempts: 0,
      })
    }

    const io = realStreams()
    await runWithSpinner(
      { io, label: 'Signing out', enabled: true, style: 'dify-dim' },
      () => runLogout({ io, bundle, http }),
    )
  }
}
