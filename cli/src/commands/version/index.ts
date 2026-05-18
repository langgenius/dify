import pc from 'picocolors'
import { Flags } from '../../framework/flags.js'
import { raw } from '../../framework/output.js'
import { compatString, difyCompat } from '../../version/compat.js'
import { versionInfo } from '../../version/info.js'
import { DifyCommand } from '../_shared/dify-command.js'

const RC_WARNING_LINES = [
  'WARNING: This build is a release candidate. It is in beta test, not stable,',
  '         and may have bugs. For production use, install the stable channel.',
] as const

export default class Version extends DifyCommand {
  static override description = 'Show difyctl version, channel, and supported dify range'
  static override examples = ['<%= config.bin %> version', '<%= config.bin %> version --json']

  static override flags = {
    json: Flags.boolean({ description: 'emit JSON' }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(Version, argv)
    const { version, commit, buildDate, channel } = versionInfo

    if (flags.json) {
      const payload = JSON.stringify({
        version,
        commit,
        buildDate,
        channel,
        compat: { minDify: difyCompat.minDify, maxDify: difyCompat.maxDify },
      })
      return raw(`${payload}\n`)
    }

    const lines = [
      `difyctl ${version}`,
      `  channel: ${channel}`,
      `  built:   ${buildDate} (commit ${commit.slice(0, 7)})`,
      `  compat:  ${compatString()}`,
    ]

    if (channel === 'rc') {
      lines.push('')
      const colour = process.stdout.isTTY ? pc.yellow : (s: string) => s
      for (const line of RC_WARNING_LINES)
        lines.push(colour(line))
    }

    return raw(`${lines.join('\n')}\n`)
  }
}
