import { httpRetryFlag } from '@/commands/_shared/global-flags'
import { Flags } from '@/framework/flags'
import { OutputFormat } from '@/framework/output'

export const KNOWLEDGE_FS_CONSISTENCY_CLASSES = [
  'path-consistent',
  'snapshot-consistent',
  'cache-consistent',
  'eventual-preview',
] as const

export const KNOWLEDGE_FS_RESOURCE_TYPES = [
  'source',
  'document',
  'node',
  'artifact',
  'evidence',
  'workspace',
] as const

export function knowledgeFsFlags() {
  return {
    workspace: Flags.string({
      char: 'w',
      description: 'workspace id (overrides DIFY_WORKSPACE_ID and stored default)',
    }),
    'consistency-class': Flags.string({
      description: 'KnowledgeFS read consistency',
      options: KNOWLEDGE_FS_CONSISTENCY_CLASSES,
    }),
    'http-retry': httpRetryFlag,
    output: Flags.outputFormat({
      options: [OutputFormat.JSON, OutputFormat.YAML, OutputFormat.TEXT],
      default: '',
    }),
  }
}

export function paginatedKnowledgeFsFlags() {
  return {
    ...knowledgeFsFlags(),
    cursor: Flags.string({ description: 'pagination cursor from the previous response' }),
    limit: Flags.integer({ description: 'maximum results [1..100]', default: 20 }),
  }
}
