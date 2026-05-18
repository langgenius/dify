import { Flags } from '../../../framework/flags.js'
import { raw, table } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runGetWorkspace } from './run.js'

export default class GetWorkspace extends DifyCommand {
  static override description = 'List workspaces visible to the current bearer'

  static override examples = [
    '<%= config.bin %> get workspace',
    '<%= config.bin %> get workspace -o json',
    '<%= config.bin %> get workspace -o name',
  ]

  static override flags = {
    'http-retry': httpRetryFlag,
    'output': Flags.string({ char: 'o', description: 'output format (json|yaml|name|wide)', default: '' }),
  }

  async run(argv: string[]) {
    const { flags } = await this.parse(GetWorkspace, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runGetWorkspace({ format }, { bundle: ctx.bundle, http: ctx.http, io: ctx.io })
    if (result.kind === 'empty')
      return raw(result.message)
    return table({
      format,
      data: result.data,
    })
  }
}
