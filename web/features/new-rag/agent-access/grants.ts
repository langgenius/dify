import type { KnowledgeAgentGrantResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { KnowledgeBaseOption } from './knowledge-base-options'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { agentAccessErrorCode, rejectedKnowledgeBaseIds } from './agent-access'

export function grantName(grant: KnowledgeAgentGrantResponse) {
  return grant.client_name ?? grant.name
}

export function useGrantError() {
  const { t } = useTranslation(['knowledgeSpace'])
  return (error: unknown, options: readonly KnowledgeBaseOption[]) => {
    const code = agentAccessErrorCode(error)
    const names = rejectedKnowledgeBaseIds(error)
      .map((id) => options.find((option) => option.id === id)?.name ?? id)
      .join(', ')
    if (code === 'knowledge_base_agent_access_blocked')
      return t(($) => $['agents.errorBlocked'], { names })
    if (code === 'invalid_knowledge_bases')
      return t(($) => $['agents.errorKnowledgeBases'], { names })
    if (code === 'agent_access_disabled') return t(($) => $['agents.workspaceDisabled'])
    return t(($) => $['agents.errorGeneric'])
  }
}

export function useInvalidateAgentAccess() {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: consoleQuery.knowledgeFs.agentAccess.key() })
}
