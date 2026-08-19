import type { SearchDocument, SearchResult } from './search'
import type { TableCell, TableColumn } from '@/framework/output'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { Args, Flags } from '@/framework/flags'
import { describeCommand } from '@/framework/help'
import { OutputFormat, table } from '@/framework/output'
import { collectCommands } from '@/framework/registry'
import { searchCommands } from './search'

const SEARCH_COLUMNS: readonly TableColumn[] = [
  { name: 'PATH', priority: 0 },
  { name: 'DESCRIPTION', priority: 0 },
  { name: 'EFFECT', priority: 0 },
  { name: 'SCORE', priority: 0 },
]

class SearchOutput {
  readonly results: readonly SearchResult[]

  constructor(results: readonly SearchResult[]) {
    this.results = results
  }

  tableColumns(): readonly TableColumn[] {
    return SEARCH_COLUMNS
  }

  tableRows(): readonly (readonly TableCell[])[] {
    return this.results.map((result) => [
      result.path,
      result.description,
      result.effect,
      result.score,
    ])
  }

  json(): { results: readonly SearchResult[] } {
    return { results: this.results }
  }
}

export default class Search extends DifyCommand {
  static override description = 'Find commands by intent using the live help metadata'

  static override examples = [
    '<%= config.bin %> search "export an app"',
    '<%= config.bin %> search "export an app" -o json',
  ]

  static override args = {
    intent: Args.string({ description: 'intent to match against command help', required: true }),
  }

  static override flags = {
    output: Flags.outputFormat({
      options: [OutputFormat.JSON, OutputFormat.YAML],
      default: '',
    }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(Search, argv)
    const { commandTree } = await import('@/commands/tree.generated')
    const documents: SearchDocument[] = collectCommands(commandTree)
      .filter(({ path }) => path.join(' ') !== 'search')
      .map(({ command, path }) => {
        const descriptor = describeCommand(command, path.join(' '))
        return {
          path: descriptor.command,
          description: descriptor.description,
          effect: descriptor.effect,
          flags: descriptor.flags,
          agentGuide: descriptor.agentGuide,
        }
      })

    return table({
      format: flags.output,
      data: new SearchOutput(searchCommands(args.intent, documents)),
    })
  }
}
