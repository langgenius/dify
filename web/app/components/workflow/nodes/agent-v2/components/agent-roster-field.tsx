import type { RefObject } from 'react'
import type { AgentRosterNodeData } from '@/app/components/workflow/block-selector/types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentSelectorContent } from '@/app/components/workflow/block-selector/agent-selector'
import { getAgentDetailPath } from '@/features/agent-v2/agent-detail/routes'
import Link from '@/next/link'

const i18nPrefix = 'nodes.agent'

function AgentRosterAvatar({
  agent,
  size = 'lg',
  className,
}: {
  agent: AgentRosterNodeData
  size?: 'xs' | 'md' | 'lg'
  className?: string
}) {
  const imageUrl = (agent.icon_type === 'image' || agent.icon_type === 'link') ? agent.icon : undefined

  return (
    <AvatarRoot
      size={size}
      className={cn('border-[0.5px] border-divider-regular', className)}
      style={{ background: imageUrl ? undefined : (agent.icon_background || '#FFEAD5') }}
    >
      {imageUrl && (
        <AvatarImage
          src={imageUrl}
          alt={agent.name}
        />
      )}
      <AvatarFallback size={size} className="text-text-primary-on-surface">
        {agent.icon_type === 'emoji' && agent.icon ? agent.icon : agent.name[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}

function AgentRosterDrawer({
  agent,
  open,
  portalContainerRef,
  onClose,
}: {
  agent: AgentRosterNodeData
  open: boolean
  portalContainerRef: RefObject<HTMLDivElement | null>
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <Drawer
      open={open}
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <DrawerPortal container={portalContainerRef}>
        <DrawerViewport className="pointer-events-none">
          <DrawerPopup
            className="pointer-events-auto p-0 data-[swipe-direction=right]:top-14 data-[swipe-direction=right]:bottom-1 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-r-[0.5px] data-[swipe-direction=right]:border-divider-subtle data-[swipe-direction=right]:shadow-2xl data-[swipe-direction=right]:shadow-shadow-shadow-5"
            style={{
              right: 'var(--workflow-node-panel-right, 4px)',
              width: 'var(--workflow-node-panel-width, 400px)',
            }}
          >
            <DrawerContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 pb-0">
              <header className="flex h-[108px] shrink-0 flex-col gap-3 border-b border-divider-subtle bg-components-panel-bg py-3 pr-4 pl-3">
                <div className="flex h-10 min-w-0 items-start justify-between">
                  <div className="flex h-10 min-w-0 flex-1 items-center gap-2 px-0.5 py-0.5">
                    <AgentRosterAvatar agent={agent} size="md" className="size-9" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
                      <div className="flex min-w-0 items-center gap-1">
                        <DrawerTitle className="truncate system-sm-medium text-text-secondary">
                          {agent.name}
                        </DrawerTitle>
                        <span aria-hidden className="i-ri-lock-line size-3 shrink-0 text-text-tertiary" />
                      </div>
                      <p className="truncate system-xs-regular text-text-tertiary">
                        {agent.role}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 py-1">
                    <button
                      type="button"
                      aria-label={t(`${i18nPrefix}.roster.more`, { ns: 'workflow' })}
                      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                    >
                      <span aria-hidden className="i-ri-more-fill size-4" />
                    </button>
                    <div className="flex h-3.5 items-start px-1">
                      <div className="h-full w-px bg-divider-regular" />
                    </div>
                    <DrawerCloseButton
                      aria-label={t('operation.close', { ns: 'common' })}
                      className="size-6 rounded-md"
                    />
                  </div>
                </div>
                <div className="flex h-8 gap-2 pl-1">
                  <Link
                    href={getAgentDetailPath(agent.id, 'configure')}
                    className="inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 text-[13px] leading-4 font-medium whitespace-nowrap text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[5px] hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  >
                    <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
                    <span className="truncate">
                      {t(`${i18nPrefix}.roster.editInConsole`, { ns: 'workflow' })}
                    </span>
                  </Link>
                  <Button
                    variant="secondary"
                    size="medium"
                    className="min-w-0 flex-1 gap-1.5 px-3"
                  >
                    <span aria-hidden className="i-ri-file-copy-2-line size-4 shrink-0" />
                    <span className="truncate">
                      {t(`${i18nPrefix}.roster.makeCopy`, { ns: 'workflow' })}
                    </span>
                  </Button>
                </div>
              </header>
              <div
                role="region"
                aria-label={t(`${i18nPrefix}.roster.panelLabel`, { ns: 'workflow', name: agent.name })}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                <div className="h-full min-h-80 bg-components-panel-bg" />
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

export function AgentRosterField({
  agent,
  portalContainerRef,
  onChange,
}: {
  agent?: AgentRosterNodeData
  portalContainerRef: RefObject<HTMLDivElement | null>
  onChange: (agent: AgentRosterNodeData) => void
}) {
  const { t } = useTranslation()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const rosterRequiredMessage = t('errorMsg.fieldRequired', {
    ns: 'workflow',
    field: t(`${i18nPrefix}.roster.label`, { ns: 'workflow' }),
  })

  return (
    <FieldRoot name="agent_roster" className="gap-1 px-4 py-2">
      <div className="flex h-6 items-center gap-2">
        <FieldLabel className="min-w-0 flex-1 py-1 system-sm-semibold-uppercase! text-text-secondary">
          {t('nodes.agent.roster.label', { ns: 'workflow' })}
        </FieldLabel>
        <Popover open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
          <PopoverTrigger
            render={(
              <button
                type="button"
                className="flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                {t(`${i18nPrefix}.roster.change`, { ns: 'workflow' })}
              </button>
            )}
          />
          <PopoverContent
            placement="bottom-end"
            sideOffset={4}
            popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
          >
            <PopoverTitle className="sr-only">
              {t('roster.nodeSelector.dialogLabel', { ns: 'agentV2' })}
            </PopoverTitle>
            <AgentSelectorContent
              open={isSelectorOpen}
              onOpenChange={setIsSelectorOpen}
              onSelect={(nextAgent) => {
                setIsSelectorOpen(false)
                onChange(nextAgent)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      {agent
        ? (
            <>
              <button
                type="button"
                aria-label={t(`${i18nPrefix}.roster.openPanel`, { ns: 'workflow', name: agent.name })}
                className="flex h-13 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg py-2 pr-4 pl-2 text-left shadow-xs shadow-shadow-shadow-3 hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={() => setIsPanelOpen(true)}
              >
                <AgentRosterAvatar agent={agent} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
                  <span className="truncate system-sm-medium text-text-secondary">
                    {agent.name}
                  </span>
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {agent.role}
                  </span>
                </span>
                <span className="flex shrink-0 items-center text-text-tertiary">
                  <span aria-hidden className="i-ri-arrow-right-line size-4" />
                </span>
              </button>
              <AgentRosterDrawer
                agent={agent}
                open={isPanelOpen}
                portalContainerRef={portalContainerRef}
                onClose={() => setIsPanelOpen(false)}
              />
            </>
          )
        : (
            <div className="flex h-13 w-full min-w-0 items-center gap-2 rounded-[10px] border-[0.5px] border-state-destructive-border bg-components-panel-on-panel-item-bg py-2 pr-4 pl-2 text-left shadow-xs shadow-shadow-shadow-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-state-destructive-hover text-text-destructive">
                <span aria-hidden className="i-ri-error-warning-line size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate system-sm-medium text-text-destructive">
                {rosterRequiredMessage}
              </span>
            </div>
          )}
    </FieldRoot>
  )
}
