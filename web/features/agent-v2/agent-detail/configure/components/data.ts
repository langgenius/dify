import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import type {
  MetadataFilteringConditions,
  MetadataFilteringModeEnum,
  MultipleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { DataSet } from '@/models/datasets'
import type { RETRIEVE_TYPE } from '@/types/app'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export type AgentFileNode = {
  id: string
  name: string
  icon: FileTreeIconType
  children?: AgentFileNode[]
}

type AgentToolBase = {
  id: string
  name: string
}

export type AgentToolAction = {
  id: string
  name: string
  toolName: string
  description: string
}

export type AgentProviderTool = AgentToolBase & {
  kind: 'provider'
  iconClassName: string
  credentialKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  credentialVariant: 'authorized' | 'endUser'
  actions: AgentToolAction[]
}

export type AgentCliTool = AgentToolBase & {
  kind: 'cli'
  action?: 'preAuthorize'
}

export type AgentTool = AgentProviderTool | AgentCliTool

export type AgentKnowledgeRetrievalItem = {
  id: string
  name?: string
  nameKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.knowledgeRetrieval.'>
  queryMode?: 'agent' | 'custom'
  customQuery?: string
  selectedDatasets?: DataSet[]
  retrievalMode?: RETRIEVE_TYPE
  multipleRetrievalConfig?: MultipleRetrievalConfig
  metadataFilterMode?: MetadataFilteringModeEnum
  metadataFilteringConditions?: MetadataFilteringConditions
  metadataModelConfig?: ModelConfig
}
