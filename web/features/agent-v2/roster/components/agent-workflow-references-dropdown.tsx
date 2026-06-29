'use client'

import type { AgentAppPublishedReferenceResponse, AgentIconType } from '@dify/contracts/api/console/agent/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from '#i18n'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'

const getWorkflowReferenceHref = (reference: AgentAppPublishedReferenceResponse) => `/app/${reference.app_id}/workflow`

const getWorkflowReferenceIconType = (reference: AgentAppPublishedReferenceResponse): AgentIconType | undefined => {
  if (reference.app_icon_type === 'image' || reference.app_icon_type === 'link')
    return 'image'

  if (reference.app_icon_type === 'emoji')
    return 'emoji'

  return undefined
}

const getWorkflowReferenceImageUrl = (reference: AgentAppPublishedReferenceResponse) => {
  if (reference.app_icon_type === 'image' || reference.app_icon_type === 'link')
    return reference.app_icon

  return undefined
}

export function AgentWorkflowReferencesDropdown({
  agentName,
  publishedReferences,
  referenceCount,
}: {
  agentName: string
  publishedReferences: AgentAppPublishedReferenceResponse[]
  referenceCount: number
}) {
  const { t } = useTranslation('agentV2')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t('roster.references.trigger', { name: agentName, count: referenceCount })}
        className="-ml-1 flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
      >
        <span aria-hidden className="i-custom-vender-agent-v2-plan size-3 shrink-0 text-text-tertiary" />
        <span className="system-xs-regular text-text-tertiary">{referenceCount}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" sideOffset={4} popupClassName="w-[264px] p-1">
        <div className="flex h-7.5 items-center px-2 system-xs-medium text-text-tertiary">
          {t('roster.references.label', { name: agentName })}
        </div>
        {publishedReferences.map(reference => (
          <DropdownMenuLinkItem
            key={reference.app_id}
            render={<Link href={getWorkflowReferenceHref(reference)} />}
            className="mx-0 h-8 gap-2 px-2 py-1 pr-2.5 system-md-regular text-text-secondary"
          >
            <span aria-hidden className="shrink-0">
              <AppIcon
                size="tiny"
                iconType={getWorkflowReferenceIconType(reference)}
                icon={reference.app_icon ?? undefined}
                background={reference.app_icon_background}
                imageUrl={getWorkflowReferenceImageUrl(reference)}
              />
            </span>
            <span className="min-w-0 flex-1 truncate">{reference.app_name}</span>
            <span aria-hidden className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary" />
          </DropdownMenuLinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
