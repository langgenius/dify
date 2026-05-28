import type { I18nKeysWithPrefix } from '@/types/i18n'

export type AgentAccessSource = {
  nameKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  descriptionKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  lastUsedKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.access.entries.'>
  reference: string
  status: 'enabled' | 'disabled'
  icon: string
  external?: boolean
}

export const agentAccessSources: AgentAccessSource[] = [
  {
    nameKey: 'agentDetail.access.entries.webapp.name',
    descriptionKey: 'agentDetail.access.entries.webapp.description',
    lastUsedKey: 'agentDetail.access.entries.webapp.lastUsed',
    reference: 'https://udify.app/chat/n8nGpwrg',
    status: 'enabled',
    icon: 'i-ri-window-line',
  },
]
