'use client'

import type { AgentAppPublishedReferenceResponse } from '@dify/contracts/api/console/agent/types.gen'
import { zAgentIconType } from '@dify/contracts/api/console/agent/zod.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'

const getWorkflowReferenceHref = (reference: AgentAppPublishedReferenceResponse) =>
  `/app/${reference.app_id}/workflow`

const getWorkflowReferenceIcon = (reference: AgentAppPublishedReferenceResponse) => {
  const parsedIconType = zAgentIconType.safeParse(reference.app_icon_type).data

  return {
    iconType: parsedIconType === 'link' ? 'image' : parsedIconType,
    imageUrl:
      parsedIconType === 'image' || parsedIconType === 'link' ? reference.app_icon : undefined,
  }
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
      <DropdownMenuTrigger className="pointer-events-auto relative -m-1 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md p-1 outline-hidden before:pointer-events-none before:absolute before:inset-0 before:rounded-md before:content-[''] hover:before:bg-state-base-hover focus-visible:before:ring-2 focus-visible:before:ring-state-accent-solid data-popup-open:before:bg-state-base-hover">
        <span
          aria-hidden
          className="i-custom-vender-agent-v2-plan size-3 shrink-0 text-text-tertiary"
        />
        <span className="sr-only">
          {t(($) => $['roster.references.trigger'], { name: agentName })}:{' '}
        </span>
        <span className="system-xs-regular text-text-tertiary">{referenceCount}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" sideOffset={4} className="w-66 p-1">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex w-full min-w-0 truncate pt-2 pr-3 pb-1.5 pl-2 system-xs-medium text-text-tertiary normal-case">
            {t(($) => $['roster.references.label'], { name: agentName })}
          </DropdownMenuLabel>
          {publishedReferences.map((reference) => {
            const { iconType, imageUrl } = getWorkflowReferenceIcon(reference)

            return (
              <DropdownMenuLinkItem
                key={reference.app_id}
                render={
                  <Link
                    href={getWorkflowReferenceHref(reference)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                className="group mx-0 h-8 gap-2 px-2 py-1 pr-2.5 system-md-regular text-text-secondary"
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
                <span className="min-w-0 flex-1 truncate" title={reference.app_name}>
                  {reference.app_name}
                </span>
                <span
                  aria-hidden
                  className="i-ri-external-link-line size-3 shrink-0 text-text-quaternary group-data-highlighted:text-text-secondary"
                />
              </DropdownMenuLinkItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
