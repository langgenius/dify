'use client'

import { skipToken, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/console'
import { toExternalAgentOverview } from '../model'
import { ExternalAgentRequestState } from '../request-state'
import { ExternalAgentOverviewActions } from './actions'
import { ExternalAgentOverviewContent } from './content'
import { ExternalAgentIdentity } from './identity'

export function ExternalAgentOverviewPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster'])
  const workspace = useAtomValue(currentWorkspaceAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const canRead = !workspaceLoading && ['owner', 'admin', 'editor'].includes(workspace.role)
  const detail = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: canRead ? { params: { agent_id: agentId } } : skipToken,
    }),
  )
  useDocumentTitle(detail.data?.asset.name ?? t(($) => $['external.overview.title']))
  if (!canRead || detail.isPending || detail.isError) {
    return (
      <ExternalAgentRequestState
        pending={workspaceLoading || (canRead && detail.isPending)}
        forbidden={!workspaceLoading && !canRead}
        error={detail.error}
      />
    )
  }
  const overview = toExternalAgentOverview(detail.data)

  return (
    <div className="my-1 me-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background-default">
      <div className="flex shrink-0 flex-wrap items-center gap-4 p-6">
        <ExternalAgentIdentity agent={overview.agent} />
        <ExternalAgentOverviewActions key={`${workspace.id}:${agentId}`} overview={overview} />
      </div>
      <div
        data-external-agent-overview-scroll
        className="@container/external-agent isolate min-h-0 flex-1 overflow-y-auto"
      >
        <ExternalAgentOverviewContent overview={overview} />
      </div>
    </div>
  )
}
