'use client'

import type { AgentProviderTool, ToolSettingTarget } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from '@langgenius/dify-ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

function ProviderIcon({
  iconClassName,
}: {
  iconClassName: string
}) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge">
      <span aria-hidden className={cn('size-3.5', iconClassName)} />
    </span>
  )
}

function CredentialStatus({
  credentialKey,
  variant,
}: {
  credentialKey: AgentProviderTool['credentialKey']
  variant: AgentProviderTool['credentialVariant']
}) {
  const { t } = useTranslation('agentV2')

  return (
    <button
      type="button"
      className="flex shrink-0 items-center justify-center rounded-md px-1.5 py-1 text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
    >
      {variant === 'authorized'
        ? <span aria-hidden className="mr-1 size-2 rounded-[3px] border border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg shadow-status-indicator-green-shadow" />
        : <span aria-hidden className="mr-1 i-ri-user-settings-line size-3.5 text-text-secondary" />}
      <span className="truncate system-xs-medium">{t(credentialKey)}</span>
      <span aria-hidden className="ml-0.5 i-custom-vender-solid-arrows-arrow-down-round-fill size-3.5 text-text-tertiary" />
    </button>
  )
}

export function AgentProviderToolItem({
  tool,
  isExpanded,
  onOpenChange,
  onConfigureAction,
  onRemoveAction,
  onRemoveProvider,
}: {
  tool: AgentProviderTool
  isExpanded: boolean
  onOpenChange: (open: boolean) => void
  onConfigureAction: (target: ToolSettingTarget) => void
  onRemoveAction: (actionId: string) => void
  onRemoveProvider: () => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <CollapsibleRoot
      open={isExpanded}
      onOpenChange={onOpenChange}
      className="overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-1 shadow-xs shadow-shadow-shadow-3"
    >
      <div className="flex min-h-7 items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-1">
        <CollapsibleTrigger
          className="group min-h-0 min-w-0 flex-1 justify-start gap-2 rounded-md px-0 pr-1 text-left hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary"
        >
          <ProviderIcon iconClassName={tool.iconClassName} />
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate system-sm-medium text-text-primary">
              {tool.name}
            </span>
            <span
              aria-hidden
              className={cn(
                'i-custom-vender-solid-arrows-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-quaternary transition-transform group-data-panel-open:rotate-0 motion-reduce:transition-none',
              )}
            />
          </span>
        </CollapsibleTrigger>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t('agentDetail.configure.tools.moreActions', { name: tool.name })}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover"
          >
            <span className="sr-only">{t('agentDetail.configure.tools.moreActions', { name: tool.name })}</span>
            <span aria-hidden className="i-ri-more-fill size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-44">
            <DropdownMenuItem
              variant="destructive"
              className="gap-2"
              onClick={onRemoveProvider}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span>{t('agentDetail.configure.tools.removeProvider')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CredentialStatus credentialKey={tool.credentialKey} variant={tool.credentialVariant} />
      </div>

      <CollapsiblePanel>
        <div className="flex flex-col">
          {tool.actions.map(action => (
            <div
              key={action.id}
              className="group relative flex min-h-7 items-center gap-1 rounded-md py-px pr-0 pl-1 hover:bg-state-base-hover"
            >
              <div className="absolute top-0 bottom-0 left-[13.5px] w-px bg-divider-regular" />
              <div className="flex min-w-0 flex-1 items-center py-1 pl-7">
                <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
                  {action.name}
                </span>
              </div>
              <div className="hidden shrink-0 items-center gap-1 px-0.5 group-focus-within:flex group-hover:flex">
                <button
                  type="button"
                  aria-label={t('agentDetail.configure.tools.editAction', { name: action.name })}
                  onClick={() => onConfigureAction({ action, tool })}
                  className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                </button>
                <button
                  type="button"
                  aria-label={t('agentDetail.configure.tools.removeAction', { name: action.name })}
                  onClick={() => onRemoveAction(action.id)}
                  className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}
