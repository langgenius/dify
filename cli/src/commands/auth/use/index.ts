import { loadHosts } from '../../../auth/hosts.js'
import { resolveConfigDir } from '../../../config/dir.js'
import { Args } from '../../../framework/flags.js'
import { realStreams } from '../../../io/streams.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { runUse } from './use.js'

export default class Use extends DifyCommand {
  static override description = 'Switch the active workspace for the current host'

  static override examples = [
    '<%= config.bin %> auth use ws-abc123',
  ]

  static override args = {
    workspaceId: Args.string({ description: 'workspace id to activate', required: true }),
  }

  async run(argv: string[]): Promise<void> {
    const { args } = await this.parse(Use, argv)
    const configDir = resolveConfigDir()
    const bundle = await loadHosts(configDir)
    await runUse({ configDir, io: realStreams(), bundle, workspaceId: args.workspaceId })
  }
}
