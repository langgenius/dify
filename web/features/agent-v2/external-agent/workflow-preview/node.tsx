import type { ExternalAgentWorkflowPreviewNodeData } from './types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { consoleQuery } from '@/service/console'
import { toExternalAgentOverview } from '../model'
import { ExternalAgentBadge } from './external-badge'

export function ExternalAgentWorkflowPreviewNode({
  data,
}: {
  data: ExternalAgentWorkflowPreviewNodeData
}) {
  const { t } = useTranslation(['workflow', 'agentRoster'])
  const agentId = data.agent_binding?.agent_id
  const query = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: agentId ? { params: { agent_id: agentId } } : skipToken,
      select: toExternalAgentOverview,
    }),
  )
  const agent = query.data?.agent
  const originalName = data.agent_binding?.original_reference?.display_name
  const name =
    agent?.name ??
    (typeof originalName === 'string'
      ? originalName
      : t(($) => $['external.workflow.unconnected'], { ns: 'agentRoster' }))

  return (
    <div className="flex flex-col gap-0.5 px-2.5 py-1">
      <div className="py-0.5 system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['nodes.agent.roster.label'])}
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-workflow-block-parma-bg p-1">
        <AppIcon
          size="small"
          icon={agent?.icon}
          fallback={{
            content: <span aria-hidden className="i-ri-robot-2-line size-4 text-text-tertiary" />,
            background: 'var(--color-components-icon-bg-midnight-soft)',
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {/* oxlint-disable-next-line dify/require-title-for-truncated-text -- The node panel opens the full agent identity and details. */}
            <span className="truncate system-xs-regular text-text-secondary">{name}</span>
            <ExternalAgentBadge />
          </div>
          {agent?.role && (
            <div className="truncate system-2xs-regular text-text-tertiary">{agent.role}</div>
          )}
        </div>
      </div>
    </div>
  )
}
