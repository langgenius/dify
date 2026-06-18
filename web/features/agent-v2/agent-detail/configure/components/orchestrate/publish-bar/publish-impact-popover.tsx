'use client'

import type { AgentPublishedReferenceResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { MouseEvent, ReactElement } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { cloneElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

type AgentPublishImpactPopoverProps = {
  actionLabel: string
  agentName?: string | null
  disabled?: boolean
  publishedReferenceCount?: number
  publishedReferences?: AgentPublishedReferenceResponse[]
  trigger: ReactElement<{
    onClick?: (event: MouseEvent<HTMLElement>) => void
  }>
  onPublish: () => void
}

const workflowReferenceAvatarClassNames = [
  'bg-components-icon-bg-green-soft text-components-icon-bg-green-solid',
  'bg-components-icon-bg-orange-dark-soft text-components-icon-bg-orange-dark-solid',
  'bg-components-icon-bg-pink-soft text-components-icon-bg-pink-solid',
  'bg-components-icon-bg-blue-soft text-components-icon-bg-blue-solid',
] as const

const getWorkflowReferenceHref = (reference: AgentPublishedReferenceResponse) => `/app/${reference.app_id}/workflow`

const getWorkflowReferenceInitial = (name: string) => {
  return name.trim().charAt(0).toUpperCase() || '?'
}

export function AgentPublishImpactPopover({
  actionLabel,
  agentName,
  disabled = false,
  publishedReferenceCount = 0,
  publishedReferences = [],
  trigger,
  onPublish,
}: AgentPublishImpactPopoverProps) {
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const hasPublishedReferences = publishedReferenceCount > 0 && publishedReferences.length > 0

  if (!hasPublishedReferences || disabled)
    return trigger

  const triggerWithImpact = cloneElement(trigger, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault()
      setOpen(true)
    },
  })

  const handlePublish = () => {
    setOpen(false)
    onPublish()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={triggerWithImpact}
      />
      <PopoverContent
        placement="top-end"
        sideOffset={-40}
        popupClassName="w-96 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]"
      >
        <div className="flex flex-col gap-0">
          <div className="flex flex-col gap-0.5 px-3 pt-3.5 pb-1">
            <h2 className="px-1 system-xl-semibold text-text-primary">
              {t('agentDetail.configure.publishImpact.title', {
                action: actionLabel,
                name: agentName || t('agentDetail.configure.publishImpact.fallbackAgentName'),
              })}
            </h2>
            <p className="px-1 system-xs-regular text-text-warning">
              {t('agentDetail.configure.publishImpact.descriptionPrefix')}
              {' '}
              <span className="system-xs-medium">
                {t('agentDetail.configure.publishImpact.workflowCount', { count: publishedReferenceCount })}
              </span>
              {t('agentDetail.configure.publishImpact.descriptionSuffix')}
            </p>
          </div>

          <div className="flex w-full flex-col gap-1 px-4 py-2">
            <div className="flex min-h-6 items-center system-sm-medium text-text-secondary">
              {t('agentDetail.configure.publishImpact.affectedWorkflows')}
            </div>
            <div className="flex max-h-44 flex-col gap-px overflow-y-auto rounded-xl border border-components-panel-border p-1">
              {publishedReferences.map((reference, index) => (
                <ReferenceLink key={`${reference.app_id}-${reference.workflow_id}`} reference={reference} index={index} />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-4 pt-2 pb-4">
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-w-18 rounded-lg px-3"
              onClick={() => setOpen(false)}
            >
              {t('agentDetail.configure.publishImpact.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="h-8 min-w-18 rounded-lg px-3"
              onClick={handlePublish}
            >
              {actionLabel}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ReferenceLink({
  reference,
  index,
}: {
  reference: AgentPublishedReferenceResponse
  index: number
}) {
  return (
    <Link
      href={getWorkflowReferenceHref(reference)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2.5 pl-2 system-sm-regular text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-regular system-xs-medium',
          workflowReferenceAvatarClassNames[index % workflowReferenceAvatarClassNames.length],
        )}
      >
        {getWorkflowReferenceInitial(reference.app_name)}
      </span>
      <span className="min-w-0 flex-1 truncate">{reference.app_name}</span>
      <span aria-hidden className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary" />
    </Link>
  )
}
