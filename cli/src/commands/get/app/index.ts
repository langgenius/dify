import type { AppMode } from '@dify/contracts/api/openapi/types.gen'
import { Args, Flags } from '../../../framework/flags.js'
import { table } from '../../../framework/output.js'
import { DifyCommand } from '../../_shared/dify-command.js'
import { httpRetryFlag } from '../../_shared/global-flags.js'
import { runGetApp } from './run.js'

const APP_MODE_VALUES: readonly AppMode[] = [
  'advanced-chat',
  'agent-chat',
  'channel',
  'chat',
  'completion',
  'rag-pipeline',
  'workflow',
]

export default class GetApp extends DifyCommand {
  static override description = 'List apps or describe one app\'s basic info'

  static override examples = [
    '<%= config.bin %> get app',
    '<%= config.bin %> get app app-1',
    '<%= config.bin %> get app -o json',
    '<%= config.bin %> get app -A',
  ]

  static override args = {
    id: Args.string({ description: 'app id', required: false }),
  }

  static override flags = {
    'workspace': Flags.string({ description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)' }),
    'all-workspaces': Flags.boolean({
      char: 'A',
      description: 'list apps across every workspace the bearer can see',
      default: false,
    }),
    'page': Flags.integer({ description: 'page number', default: 1 }),
    'limit': Flags.string({ description: 'page size [1..200]' }),
    'mode': Flags.string({ description: 'filter by app mode', options: APP_MODE_VALUES }),
    'name': Flags.string({ description: 'filter by app name (server-side substring)' }),
    'tag': Flags.string({ description: 'filter by tag name (server-side exact match)' }),
    'http-retry': httpRetryFlag,
    'output': Flags.string({ char: 'o', description: 'output format (json|yaml|name|wide)', default: '' }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(GetApp, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runGetApp({
      appId: args.id,
      workspace: flags.workspace,
      allWorkspaces: flags['all-workspaces'],
      page: flags.page,
      limitRaw: flags.limit,
      mode: flags.mode,
      name: flags.name,
      tag: flags.tag,
      format,
    }, { bundle: ctx.bundle, http: ctx.http, io: ctx.io })
    return table({
      format,
      data: result.data,
    })
  }
}
