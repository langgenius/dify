import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import type { AgentSkill } from './orchestrate/skills/item'
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

export const defaultAgentSkills: AgentSkill[] = [
  {
    id: 'playwright',
    name: 'Playwright',
  },
]

export const defaultAgentFiles: AgentFileNode[] = [
  {
    id: 'preview-image',
    name: 'agent-roster-skill-detail-dialog-preview-image.png',
    icon: 'image',
  },
]

export const defaultAgentTools: AgentTool[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    kind: 'provider',
    iconClassName: 'i-custom-public-other-default-tool-icon text-[#ef5b39]',
    credentialKey: 'agentDetail.configure.tools.credential.authOne',
    credentialVariant: 'authorized',
    actions: [
      {
        id: 'duckduckgo-ai-chat',
        name: 'DuckDuckGo AI Chat',
        toolName: 'duckduckgo_ai_chat',
        description: 'Chat with DuckDuckGo AI for lightweight web answers.',
      },
      {
        id: 'duckduckgo-image-search',
        name: 'DuckDuckGo Image Search',
        toolName: 'duckduckgo_image_search',
        description: 'Search DuckDuckGo images and return matching image results.',
      },
      {
        id: 'duckduckgo-search',
        name: 'DuckDuckGo Search',
        toolName: 'duckduckgo_search',
        description: 'Search DuckDuckGo and return relevant webpage snippets.',
      },
      {
        id: 'duckduckgo-translate',
        name: 'DuckDuckGo Translate',
        toolName: 'duckduckgo_translate',
        description: 'Translate short text with DuckDuckGo translation tools.',
      },
    ],
  },
  {
    id: 'lark-cli-badge',
    name: 'Lark CLI',
    kind: 'cli',
  },
]

export const defaultAgentKnowledgeRetrievals: AgentKnowledgeRetrievalItem[] = [
  {
    id: 'retrieval-1',
    nameKey: 'agentDetail.configure.knowledgeRetrieval.retrievalOne',
  },
]
