import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import type { AgentSkill } from './agent-skills/agent-skill-item'
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
  nameKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.knowledgeRetrieval.'>
}

export const defaultAgentSkills: AgentSkill[] = [
  {
    id: 'tender-analyzer-1',
    name: 'tender-analyzer',
  },
  {
    id: 'playwright',
    name: 'Playwright',
  },
  {
    id: 'figma-code-connect',
    name: 'Figma Code Connect',
  },
  {
    id: 'tender-analyzer-2',
    name: 'tender-analyzer',
  },
]

export const defaultAgentFiles: AgentFileNode[] = [
  {
    id: 'index-json',
    name: '_index.json',
    icon: 'json',
  },
  {
    id: 'web-game',
    name: 'web-game',
    icon: 'folder',
    children: [
      {
        id: 'web-game-public',
        name: 'public',
        icon: 'folder',
      },
      {
        id: 'web-game-assets',
        name: 'assets',
        icon: 'folder',
      },
      {
        id: 'web-game-src',
        name: 'src',
        icon: 'folder',
      },
      {
        id: 'web-game-styles',
        name: 'styles',
        icon: 'folder',
      },
      {
        id: 'web-game-readme',
        name: 'README.md',
        icon: 'markdown',
      },
    ],
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
    id: 'web-search',
    name: 'Web Search',
    kind: 'provider',
    iconClassName: 'i-ri-search-line text-[#ef3d32]',
    credentialKey: 'agentDetail.configure.tools.credential.endUserOAuth',
    credentialVariant: 'endUser',
    actions: [
      {
        id: 'web-search-query',
        name: 'Search',
        toolName: 'web_search',
        description: 'Search the web and return relevant result snippets.',
      },
      {
        id: 'web-search-read',
        name: 'Read webpage',
        toolName: 'read_webpage',
        description: 'Read and summarize content from a webpage URL.',
      },
    ],
  },
  {
    id: 'lark-cli-badge',
    name: 'Lark CLI',
    kind: 'cli',
  },
  {
    id: 'lark-cli-action',
    name: 'Lark CLI',
    kind: 'cli',
    action: 'preAuthorize',
  },
]

export const defaultAgentKnowledgeRetrievals: AgentKnowledgeRetrievalItem[] = [
  {
    id: 'retrieval-1',
    nameKey: 'agentDetail.configure.knowledgeRetrieval.retrievalOne',
  },
  {
    id: 'retrieval-2',
    nameKey: 'agentDetail.configure.knowledgeRetrieval.retrievalTwo',
  },
]
