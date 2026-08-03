import type { KnowledgeFsConsistencyClass } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { paginatedKnowledgeFsFlags } from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsList extends DifyCommand {
  static override description = 'List a KnowledgeFS directory'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs ls knowledge-space-1 /knowledge',
    '<%= config.bin %> knowledge fs ls knowledge-space-1 /knowledge --limit 50 -o json',
  ]

  static override args = {
    knowledgeSpaceId: Args.string({ description: 'knowledge-space id', required: true }),
    path: Args.string({ description: 'KnowledgeFS directory path', required: true }),
  }

  static override flags = paginatedKnowledgeFsFlags()

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsList, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, knowledgeSpaceId: args.knowledgeSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Listing KnowledgeFS directory',
        execute: (client, workspaceId, knowledgeSpaceId) =>
          client.list(workspaceId, knowledgeSpaceId, {
            path: args.path,
            page_size: flags.limit,
            page_token: flags.cursor,
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
