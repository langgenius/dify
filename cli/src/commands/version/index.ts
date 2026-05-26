import { Flags } from '../../framework/flags.js'
import { formatted, raw, stringifyOutput } from '../../framework/output.js'
import { colorEnabled } from '../../sys/io/color.js'
import { realStreams } from '../../sys/io/streams'
import { versionInfo } from '../../version/info.js'
import { runVersionProbe } from '../../version/probe.js'
import { renderVersionText } from '../../version/render.js'
import { DifyCommand } from '../_shared/dify-command.js'

export const COMPAT_FAIL_EXIT_CODE = 64

export default class Version extends DifyCommand {
  static override description = 'Show difyctl version, probe server, and report compatibility'
  static override examples = [
    '<%= config.bin %> version',
    '<%= config.bin %> version --short',
    '<%= config.bin %> version --client',
    '<%= config.bin %> version -o json',
    '<%= config.bin %> version --check-compat',
  ]

  static override flags = {
    'output': Flags.string({
      char: 'o',
      description: 'output format (text|json|yaml)',
      default: '',
    }),
    'client': Flags.boolean({ description: 'skip server probe' }),
    'short': Flags.boolean({ description: 'print only the client semver' }),
    'check-compat': Flags.boolean({
      description: `exit ${COMPAT_FAIL_EXIT_CODE} if server is not 'compatible'`,
    }),
  }

  async run(argv: string[]) {
    const { flags } = this.parse(Version, argv)

    if (flags.short)
      return raw(`${versionInfo.version}\n`)

    const report = await runVersionProbe({ skipServer: flags.client })

    const io = realStreams(flags.output)
    const useColor = colorEnabled(io.isOutTTY)
    const output = formatted({
      format: flags.output,
      data: {
        text: () => renderVersionText(report, { color: useColor }),
        json: () => report,
      },
    })

    if (flags['check-compat'] && report.compat.status !== 'compatible') {
      // Emit the full report first so `difyctl version -o json --check-compat | jq`
      // works exactly like the success path: stdout gets the canonical envelope,
      // stderr gets the one-line failure reason, exit code signals the verdict.
      io.out.write(stringifyOutput(output))
      this.error(report.compat.detail, { exit: COMPAT_FAIL_EXIT_CODE })
    }

    return output
  }
}
