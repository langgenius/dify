import { DifyCommand } from '@/commands/_shared/dify-command'
import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Flags } from '@/framework/flags'
import { pluginDependencyLabel, runImportApp } from './run'

export default class ImportApp extends DifyCommand {
  static override description = 'Import an app from a DSL YAML file or URL'

  static override examples = [
    '<%= config.bin %> import app --from-file ./app.yaml',
    '<%= config.bin %> import app --from-file /path/to/app.yaml --name "My App"',
    '<%= config.bin %> import app --from-url https://example.com/my-app.yaml',
    '<%= config.bin %> import app --from-file ./app.yaml --app-id <existing-app-id>',
  ]

  static override flags = {
    'from-file': Flags.string({ description: 'import DSL from a local file (relative or absolute path)', char: 'f' }),
    'from-url': Flags.string({ description: 'import DSL from an HTTP(S) URL' }),
    'workspace': Flags.string({ description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)' }),
    'name': Flags.string({ description: 'override the app name from the DSL' }),
    'description': Flags.string({ description: 'override the app description from the DSL' }),
    'app-id': Flags.string({ description: 'overwrite an existing app (workflow/advanced-chat only)' }),
    'icon-type': Flags.string({ description: 'override icon type' }),
    'icon': Flags.string({ description: 'override icon' }),
    'icon-background': Flags.string({ description: 'override icon background colour' }),
    'http-retry': httpRetryFlag,
  }

  async run(argv: string[]) {
    const { flags } = this.parse(ImportApp, argv)
    if (flags['from-file'] === undefined && flags['from-url'] === undefined)
      this.error('one of --from-file or --from-url is required', { exit: 1 })
    if (flags['from-file'] !== undefined && flags['from-url'] !== undefined)
      this.error('--from-file and --from-url are mutually exclusive', { exit: 1 })
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'] })
    const { result, leakedDependencies } = await runImportApp({
      fromFile: flags['from-file'],
      fromUrl: flags['from-url'],
      workspace: flags.workspace,
      name: flags.name,
      description: flags.description,
      appId: flags['app-id'],
      iconType: flags['icon-type'],
      icon: flags.icon,
      iconBackground: flags['icon-background'],
    }, { active: ctx.active, http: ctx.http, io: ctx.io })

    const status = result.status === 'completed-with-warnings' ? 'completed (with warnings)' : result.status
    ctx.io.err.write(`Import ${status}`)
    if (result.app_id !== undefined && result.app_id !== null)
      ctx.io.err.write(`: app ${result.app_id}`)
    ctx.io.err.write('\n')

    if (leakedDependencies.length > 0) {
      ctx.io.err.write(`\nMissing plugin dependencies (${leakedDependencies.length}); install them before using the app:\n`)
      for (const dep of leakedDependencies)
        ctx.io.err.write(`  - ${pluginDependencyLabel(dep)}\n`)
    }
  }
}
