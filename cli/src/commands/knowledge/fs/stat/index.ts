import type { KnowledgeFsConsistencyClass } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import { knowledgeFsFlags } from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsStat extends DifyCommand {
  static override description = 'Read KnowledgeFS path metadata'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs stat control-space-1 /knowledge/docs/readme.md',
    '<%= config.bin %> knowledge fs stat control-space-1 /knowledge/docs/readme.md -o json',
  ]

  static override args = {
    controlSpaceId: Args.string({ description: 'KnowledgeFS control-space id', required: true }),
    path: Args.string({ description: 'KnowledgeFS path', required: true }),
  }

  static override flags = knowledgeFsFlags()

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsStat, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, controlSpaceId: args.controlSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Reading KnowledgeFS metadata',
        execute: (client, workspaceId, controlSpaceId) =>
          client.stat(workspaceId, controlSpaceId, {
            path: args.path,
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
