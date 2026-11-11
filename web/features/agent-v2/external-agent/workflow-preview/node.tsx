import type { ExternalAgentWorkflowPreviewNodeData } from './types'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { ExternalAgentBadge } from './external-badge'

export function ExternalAgentWorkflowPreviewNode({
  data,
}: {
  data: ExternalAgentWorkflowPreviewNodeData
}) {
  const { t } = useTranslation(['workflow'])
  const agent = data._externalAgentPreview

  return (
    <div className="flex flex-col gap-0.5 px-2.5 py-1">
      <div className="py-0.5 system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['nodes.agent.roster.label'])}
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-workflow-block-parma-bg p-1">
        <AppIcon
          size="small"
          icon={agent.icon}
          fallback={{
            content: <span aria-hidden className="i-ri-robot-2-line size-4 text-text-tertiary" />,
            background: 'var(--color-components-icon-bg-midnight-soft)',
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate system-xs-regular text-text-secondary">{agent.name}</span>
            <ExternalAgentBadge />
          </div>
          {agent.role && (
            <div className="truncate system-2xs-regular text-text-tertiary">{agent.role}</div>
          )}
        </div>
      </div>
    </div>
  )
}
