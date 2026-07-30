'use client'

import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import AppTracingPanel from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/panel'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { getAppACLCapabilities } from '@/utils/permission'

export function AgentMonitoringTracingPanel({ agentId }: { agentId: string }) {
  const { t } = useTranslation('agentV2')
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const agentQuery = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
  )
  const agent = agentQuery.data
  const appId = agent?.backing_app_id

  if (!appId) return null

  const { canConfigureTracing } = getAppACLCapabilities(agent.permission_keys, {
    currentUserId,
    resourceMaintainer: agent.maintainer,
    workspacePermissionKeys,
  })

  return (
    <section
      aria-labelledby="agent-monitoring-tracing-title"
      className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border-[0.5px] border-components-panel-border bg-background-default-dodge p-3 shadow-xs"
    >
      <div className="min-w-0 flex-1">
        <h3 id="agent-monitoring-tracing-title" className="system-sm-semibold text-text-secondary">
          {t(($) => $['agentDetail.monitoring.tracing.title'])}
        </h3>
        <p className="mt-0.5 system-xs-regular text-text-tertiary">
          {t(($) => $['agentDetail.monitoring.tracing.scope'])}
        </p>
      </div>
      <AppTracingPanel appId={appId} readOnly={!canConfigureTracing} />
    </section>
  )
}
