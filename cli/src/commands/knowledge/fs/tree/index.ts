import type { KnowledgeFsConsistencyClass } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { paginatedKnowledgeFsFlags } from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args, Flags } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsTree extends DifyCommand {
  static override description = 'Read a KnowledgeFS directory tree'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs tree control-space-1 /knowledge --depth 2',
    '<%= config.bin %> knowledge fs tree control-space-1 /knowledge --limit 50 -o json',
  ]

  static override args = {
    controlSpaceId: Args.string({ description: 'KnowledgeFS control-space id', required: true }),
    path: Args.string({ description: 'KnowledgeFS directory path', required: true }),
  }

  static override flags = {
    ...paginatedKnowledgeFsFlags(),
    depth: Flags.integer({ description: 'tree depth [1..8]' }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsTree, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, controlSpaceId: args.controlSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Reading KnowledgeFS tree',
        execute: (client, workspaceId, controlSpaceId) =>
          client.tree(workspaceId, controlSpaceId, {
            path: args.path,
            limit: flags.limit,
            cursor: flags.cursor,
            depth: flags.depth,
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
