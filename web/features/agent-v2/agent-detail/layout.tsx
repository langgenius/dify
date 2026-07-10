'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

const isNotFoundResponse = (error: unknown) => error instanceof Response && error.status === 404

export function AgentDetailLayout({
  agentId,
  children,
}: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')
  const router = useRouter()
  const agentQuery = useQuery(consoleQuery.agent.byAgentId.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  }))
  const shouldRedirectToRoster = isNotFoundResponse(agentQuery.error)

  useDocumentTitle(agentQuery.data?.name ?? t($ => $['agentDetail.documentTitle']))

  useEffect(() => {
    if (shouldRedirectToRoster)
      router.replace('/agents')
  }, [router, shouldRedirectToRoster])

  if (shouldRedirectToRoster)
    return null

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {children}
      </div>
    </div>
  )
}
