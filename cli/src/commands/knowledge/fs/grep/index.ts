import type { KnowledgeFsConsistencyClass } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { paginatedKnowledgeFsFlags } from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args, Flags } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsGrep extends DifyCommand {
  static override description = 'Search text under a KnowledgeFS path'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs grep knowledge-space-1 TODO /knowledge',
    '<%= config.bin %> knowledge fs grep knowledge-space-1 "release notes" /knowledge --limit 50 -o json',
  ]

  static override args = {
    knowledgeSpaceId: Args.string({ description: 'knowledge-space id', required: true }),
    query: Args.string({ description: 'text to search for', required: true }),
    path: Args.string({ description: 'KnowledgeFS path to search', required: true }),
  }

  static override flags = {
    ...paginatedKnowledgeFsFlags(),
    'timeout-ms': Flags.integer({ description: 'search timeout in milliseconds [1..10000]' }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsGrep, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, knowledgeSpaceId: args.knowledgeSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Searching KnowledgeFS text',
        execute: (client, workspaceId, knowledgeSpaceId) =>
          client.grep(workspaceId, knowledgeSpaceId, {
            path: args.path,
            text: args.query,
            page_size: flags.limit,
            page_token: flags.cursor,
            timeout_ms: flags['timeout-ms'],
            consistency_class: flags['consistency-class'] as
              | KnowledgeFsConsistencyClass
              | undefined,
          }),
      },
    )
    return formatted({ format, data: new KnowledgeFsOutput(result.data) })
  }

  override agentGuide(): string {
    return knowledgeFsAgentGuide
  }
}
