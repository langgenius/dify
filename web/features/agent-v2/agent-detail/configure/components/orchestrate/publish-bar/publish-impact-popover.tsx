'use client'

import type { AgentIconType, AgentReferencingWorkflowResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { RegisterableHotkey } from '@tanstack/react-hotkeys'
import type { MouseEvent, ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'

type PopoverTriggerClickEvent = MouseEvent<HTMLButtonElement> & {
  preventBaseUIHandler?: () => void
}

type PublishStep = 'idle' | 'checking' | 'confirming'

type AgentPublishImpactPopoverProps = {
  actionLabel: string
  actionIcon?: string | null
  actionShortcut?: ReactNode
  hotkey: RegisterableHotkey
  agentId: string
  agentName?: string | null
  disabled?: boolean
  loading?: boolean
  onPublish: () => void
}

const getWorkflowReferenceHref = (reference: AgentReferencingWorkflowResponse) => `/app/${reference.app_id}/workflow`

export function AgentPublishImpactPopover({
  actionLabel,
  actionIcon,
  actionShortcut,
  hotkey,
  agentId,
  agentName,
  disabled = false,
  loading = false,
  onPublish,
}: AgentPublishImpactPopoverProps) {
  const { t } = useTranslation('agentV2')
  const [publishStep, setPublishStep] = useState<PublishStep>('idle')
  const workflowReferencesQuery = useQuery({
    ...consoleQuery.agent.byAgentId.referencingWorkflows.get.queryOptions({
      input: {
        params: {
          agent_id: agentId,
        },
      },
    }),
    enabled: false,
  })
  const publishedReferences = workflowReferencesQuery.data?.data ?? []
  const open = publishStep === 'confirming'
  const isCheckingReferences = publishStep === 'checking'

  const handlePublish = () => {
    setPublishStep('idle')
    onPublish()
  }

  const handlePublishRequest = async () => {
    if (disabled || isCheckingReferences)
      return

    if (open) {
      handlePublish()
      return
    }

    setPublishStep('checking')
    try {
      const result = await workflowReferencesQuery.refetch()
      const references = result.data?.data ?? []
      if (references.length > 0) {
        setPublishStep('confirming')
        return
      }

      setPublishStep('idle')
      onPublish()
    }
    finally {
      setPublishStep(currentStep => currentStep === 'checking' ? 'idle' : currentStep)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen)
      setPublishStep('idle')
  }

  useHotkey(hotkey, (event) => {
    event.preventDefault()
    void handlePublishRequest()
  }, {
    enabled: !disabled,
    ignoreInputs: false,
  })

  const triggerButton = (
    <PublishImpactTriggerButton
      actionIcon={actionIcon}
      actionLabel={actionLabel}
      actionShortcut={actionShortcut}
      disabled={disabled}
      loading={loading || isCheckingReferences}
      onClick={async (event) => {
        event.preventBaseUIHandler?.()
        event.preventDefault()
        await handlePublishRequest()
      }}
    />
  )

  if (disabled)
    return triggerButton

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={triggerButton}
      />
      <PopoverContent
        placement="top-end"
        sideOffset={-32}
        popupClassName="w-96 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px] transition-[transform,scale,opacity] duration-150 ease-out data-starting-style:translate-y-5 data-ending-style:translate-y-5 motion-reduce:transition-none motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-ending-style:translate-y-0"
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
                {t('agentDetail.configure.publishImpact.workflowCount', { count: publishedReferences.length })}
              </span>
              {t('agentDetail.configure.publishImpact.descriptionSuffix')}
            </p>
          </div>

          <div className="flex w-full flex-col gap-1 px-4 py-2">
            <div className="flex min-h-6 items-center system-sm-medium text-text-secondary">
              {t('agentDetail.configure.publishImpact.affectedWorkflows')}
            </div>
            <div className="flex max-h-44 flex-col gap-px overflow-y-auto rounded-xl border border-components-panel-border p-1">
              {publishedReferences.map(reference => (
                <ReferenceLink key={`${reference.app_id}-${reference.workflow_id}`} reference={reference} />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-4 pt-2 pb-4">
            <Button
              type="button"
              variant="secondary"
              className="h-8 min-w-18 rounded-lg px-3"
              onClick={() => setPublishStep('idle')}
            >
              {t('agentDetail.configure.publishImpact.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="h-8 min-w-18 gap-1 rounded-lg px-3"
              onClick={handlePublish}
            >
              <span className="shrink-0">{actionLabel}</span>
              {actionShortcut}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PublishImpactTriggerButton({
  actionIcon,
  actionLabel,
  actionShortcut,
  disabled,
  loading,
  onClick,
}: {
  actionIcon?: string | null
  actionLabel: string
  actionShortcut?: ReactNode
  disabled?: boolean
  loading?: boolean
  onClick: (event: PopoverTriggerClickEvent) => void | Promise<void>
}) {
  return (
    <Button
      type="button"
      variant="primary"
      disabled={disabled}
      loading={loading}
      className="h-8 gap-1 rounded-lg px-3"
      onClick={onClick}
    >
      {actionIcon && (
        <span aria-hidden className={cn('size-4 shrink-0', actionIcon)} />
      )}
      <span className="shrink-0">{actionLabel}</span>
      {actionShortcut}
    </Button>
  )
}

function ReferenceLink({
  reference,
}: {
  reference: AgentReferencingWorkflowResponse
}) {
  const imageUrl = (reference.app_icon_type === 'image' || reference.app_icon_type === 'link') ? reference.app_icon : undefined
  const iconType = (imageUrl ? 'image' : reference.app_icon_type) as AgentIconType | null | undefined

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
      <span aria-hidden className="i-ri-external-link-line size-3 shrink-0 text-text-tertiary" />
    </Link>
  )
}
