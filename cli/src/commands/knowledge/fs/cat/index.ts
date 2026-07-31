import type { KnowledgeFsConsistencyClass } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { knowledgeFsFlags } from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args, Flags } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsCat extends DifyCommand {
  static override description = 'Read a KnowledgeFS file'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs cat control-space-1 /knowledge/docs/readme.md',
    '<%= config.bin %> knowledge fs cat control-space-1 /knowledge/docs/readme.md -o json',
  ]

  static override args = {
    controlSpaceId: Args.string({ description: 'KnowledgeFS control-space id', required: true }),
    path: Args.string({ description: 'KnowledgeFS file path', required: true }),
  }

  static override flags = {
    ...knowledgeFsFlags(),
    cursor: Flags.string({ description: 'continuation cursor for truncated content' }),
    limit: Flags.integer({ description: 'bounded read limit [1..100]' }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsCat, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, controlSpaceId: args.controlSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Reading KnowledgeFS file',
        execute: (client, workspaceId, controlSpaceId) =>
          client.cat(workspaceId, controlSpaceId, {
            path: args.path,
            limit: flags.limit,
            cursor: flags.cursor,
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
