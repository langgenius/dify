import type { KnowledgeFsConsistencyClass, KnowledgeFsResourceType } from '@/api/knowledge-fs'
import type { CommandEffect } from '@/framework/command'
import { DifyCommand } from '@/commands/_shared/dify-command'
import {
  KNOWLEDGE_FS_RESOURCE_TYPES,
  paginatedKnowledgeFsFlags,
} from '@/commands/knowledge/fs/_shared/flags'
import { knowledgeFsAgentGuide } from '@/commands/knowledge/fs/_shared/guide'
import { KnowledgeFsOutput } from '@/commands/knowledge/fs/_shared/output'
import { runKnowledgeFsCommand } from '@/commands/knowledge/fs/_shared/run'
import { Args, Flags } from '@/framework/flags'
import { formatted } from '@/framework/output'

export default class KnowledgeFsFind extends DifyCommand {
  static override description = 'Find KnowledgeFS paths by name or metadata'

  static override effect: CommandEffect = 'read'

  static override examples = [
    '<%= config.bin %> knowledge fs find knowledge-space-1 /knowledge --name-contains readme',
    '<%= config.bin %> knowledge fs find knowledge-space-1 /knowledge --resource-type document -o json',
  ]

  static override args = {
    knowledgeSpaceId: Args.string({ description: 'knowledge-space id', required: true }),
    path: Args.string({ description: 'KnowledgeFS path to search', required: true }),
  }

  static override flags = {
    ...paginatedKnowledgeFsFlags(),
    'metadata-key': Flags.string({ description: 'metadata key filter' }),
    'metadata-value': Flags.string({ description: 'metadata value filter' }),
    'name-contains': Flags.string({ description: 'case-insensitive name substring' }),
    'resource-type': Flags.string({
      description: 'resource type filter',
      options: KNOWLEDGE_FS_RESOURCE_TYPES,
    }),
  }

  async run(argv: string[]) {
    const { args, flags } = this.parse(KnowledgeFsFind, argv)
    const format = flags.output
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format })
    const result = await runKnowledgeFsCommand(
      { workspace: flags.workspace, knowledgeSpaceId: args.knowledgeSpaceId },
      { active: ctx.active, http: ctx.http, io: ctx.io },
      {
        label: 'Finding KnowledgeFS paths',
        execute: (client, workspaceId, knowledgeSpaceId) =>
          client.find(workspaceId, knowledgeSpaceId, {
            path: args.path,
            page_size: flags.limit,
            page_token: flags.cursor,
            metadata_key: flags['metadata-key'],
            metadata_value: flags['metadata-value'],
            name_contains: flags['name-contains'],
            resource_type: flags['resource-type'] as KnowledgeFsResourceType | undefined,
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
