import type { AgentKnowledgeDatasetConfig, AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type {
  MetadataFilteringConditions,
  MetadataFilteringModeEnum,
  MultipleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { DataSet } from '@/models/datasets'
import type { RETRIEVE_TYPE } from '@/types/app'
import type { I18nKeysWithPrefix } from '@/types/i18n'

export type EnvScope = 'secret' | 'plain'

export type EnvVariable = {
  id: string
  key: string
  value: string
  scope: EnvScope
  masked?: boolean
}

export type AgentSkill = {
  description?: string
  archiveKey?: string
  id: string
  name: string
  path?: string
  skillMdKey?: string
}

export type AgentFileNode = {
  id: string
  name: string
  icon: FileTreeIconType
  driveKey?: string
  children?: AgentFileNode[]
}

export type AgentKnowledgeRetrievalItem = {
  id: string
  name?: string
  nameKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.knowledgeRetrieval.'>
  queryMode?: 'agent' | 'custom'
  customQuery?: string
  datasetRefs?: AgentKnowledgeDatasetConfig[]
  selectedDatasets?: DataSet[]
  retrievalMode?: RETRIEVE_TYPE
  multipleRetrievalConfig?: MultipleRetrievalConfig
  metadataFilterMode?: MetadataFilteringModeEnum
  metadataFilteringConditions?: MetadataFilteringConditions
  metadataModelConfig?: ModelConfig
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

type AgentProviderToolCredentialType = 'api-key' | 'oauth2' | 'unauthorized'

export type AgentProviderTool = AgentToolBase & {
  kind: 'provider'
  displayName?: string
  iconClassName: string
  icon?: ToolDefaultValue['provider_icon']
  iconDark?: ToolDefaultValue['provider_icon_dark']
  providerType?: string
  allowDelete?: boolean
  credentialId?: string
  credentialKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
  credentialType?: AgentProviderToolCredentialType
  credentialVariant: 'authorized' | 'unauthorized' | 'none'
  actions: AgentToolAction[]
}

export type AgentCliTool = AgentToolBase & {
  kind: 'cli'
  action?: 'preAuthorize'
  installCommand?: string
  envVariables?: EnvVariable[]
}

export type AgentTool = AgentProviderTool | AgentCliTool

export type AgentSoulConfigFormState = {
  prompt: string
  model?: DefaultModel
  appFeatures?: AgentSoulAppFeaturesConfig
  tools: AgentTool[]
  knowledgeRetrievals: AgentKnowledgeRetrievalItem[]
  envVariables: EnvVariable[]
  toolSettings: Record<string, Record<string, unknown>>
}

export const defaultAgentSoulConfigFormState: AgentSoulConfigFormState = {
  prompt: '',
  tools: [],
  knowledgeRetrievals: [],
  envVariables: [],
  toolSettings: {},
}
