'use client'

import type { AgentIconType, AgentReferencingWorkflowResponse } from '@dify/contracts/api/console/agent/types.gen'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'

type AgentPublishImpactDetailsProps = {
  publishActionLabel: string
  agentName?: string | null
  references: AgentReferencingWorkflowResponse[]
}

const getWorkflowReferenceHref = (reference: AgentReferencingWorkflowResponse) => `/app/${reference.app_id}/workflow`

export function AgentPublishImpactDetails({
  publishActionLabel,
  agentName,
  references,
}: AgentPublishImpactDetailsProps) {
  const { t } = useTranslation('agentV2')
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className="flex w-full max-w-full flex-col"
    >
      <div className="flex flex-col gap-0.5 px-3 pt-3.5 pb-1">
        <h2 id={titleId} className="w-full px-1 pr-8 system-xl-semibold wrap-break-word text-text-primary">
          {t($ => $['agentDetail.configure.publishImpact.title'], {
            action: publishActionLabel,
            name: agentName || t($ => $['agentDetail.configure.publishImpact.fallbackAgentName']),
          })}
        </h2>
        <p className="px-1 system-xs-regular wrap-break-word text-text-warning">
          {t($ => $['agentDetail.configure.publishImpact.descriptionPrefix'])}
          {' '}
          <span className="system-xs-medium">
            {t($ => $['agentDetail.configure.publishImpact.workflowCount'], { count: references.length })}
          </span>
          {t($ => $['agentDetail.configure.publishImpact.descriptionSuffix'])}
        </p>
      </div>

      <div className="flex w-full flex-col gap-1 px-4 py-2">
        <div className="flex min-h-6 items-center system-sm-medium text-text-secondary">
          {t($ => $['agentDetail.configure.publishImpact.affectedWorkflows'])}
        </div>
        <div className="flex max-h-[123px] flex-col gap-px overflow-y-auto rounded-xl border border-components-panel-border p-1">
          {references.map(reference => (
            <ReferenceLink key={`${reference.app_id}-${reference.workflow_id}`} reference={reference} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ReferenceLink({
  reference,
}: {
  reference: AgentReferencingWorkflowResponse
}) {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const imageUrl = (reference.app_icon_type === 'image' || reference.app_icon_type === 'link') ? reference.app_icon : undefined
  const iconType = (imageUrl ? 'image' : reference.app_icon_type) as AgentIconType | null | undefined
  const updatedAt = reference.app_updated_at == null
    ? null
    : formatTimeFromNow(reference.app_updated_at * 1000)

  return (
    <Link
      href={getWorkflowReferenceHref(reference)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2.5 pl-2 system-sm-regular text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
    >
      <span aria-hidden className="shrink-0">
        <AppIcon
          size="tiny"
          iconType={iconType}
          icon={reference.app_icon ?? undefined}
          background={reference.app_icon_background}
          imageUrl={imageUrl}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{reference.app_name}</span>
      {updatedAt && (
        <span className="shrink-0 system-xs-regular text-text-tertiary">{updatedAt}</span>
      )}
      <span aria-hidden className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary" />
    </Link>
  )
}
