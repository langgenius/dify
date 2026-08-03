import type { KnowledgeFsConsistencyClass } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { knowledgeFsFlags } from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args, Flags } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsDiff extends DifyCommand {
  static override description = 'Diff two KnowledgeFS text paths'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs diff knowledge-space-1 /knowledge/old.md /knowledge/new.md',
    '<%= config.bin %> knowledge fs diff knowledge-space-1 /knowledge/old.md /knowledge/new.md --mode word --semantic -o json',
  ]

  static override args = {
    knowledgeSpaceId: Args.string({ description: 'knowledge-space id', required: true }),
    oldPath: Args.string({ description: 'original KnowledgeFS path', required: true }),
    newPath: Args.string({ description: 'new KnowledgeFS path', required: true }),
  }

  static override flags = {
    ...knowledgeFsFlags(),
    mode: Flags.string({ description: 'diff granularity', options: ['line', 'word'] as const }),
    semantic: Flags.boolean({
      description: 'include bounded semantic change summary',
      default: false,
    }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsDiff, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, knowledgeSpaceId: args.knowledgeSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Diffing KnowledgeFS paths',
        execute: (client, workspaceId, knowledgeSpaceId) =>
          client.diff(workspaceId, knowledgeSpaceId, {
            old_path: args.oldPath,
            new_path: args.newPath,
            mode: flags.mode as 'line' | 'word' | undefined,
            include_semantic_summary: flags.semantic || undefined,
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
