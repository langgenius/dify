'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { MainContent } from '@/app/components/main-nav/skip-nav'
import { useAppContext } from '@/context/app-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { AgentDetailSection, AgentDetailTop } from './navigation'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()
  const agentQuery = useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const shouldShowDetailSidebar = !isCurrentWorkspaceDatasetOperator

  useDocumentTitle(agentQuery.data?.name ?? t('agentDetail.documentTitle'))

  const content = (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </div>
    </div>
  )

  return (
    <div className="flex h-0 min-w-0 grow overflow-hidden bg-background-body">
      {shouldShowDetailSidebar && (
        <DetailSidebarFrame
          renderTop={({ expand, onToggle }) => (
            <AgentDetailTop
              expand={expand}
              onToggle={onToggle}
            />
          )}
          renderSection={({ expand }) => <AgentDetailSection expand={expand} />}
        />
      )}
      {shouldShowDetailSidebar
        ? <MainContent>{content}</MainContent>
        : content}
    </div>
  )
}
