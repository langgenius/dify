'use client'

import type { ReactNode } from 'react'
import type { PermissionSettingKey } from './permission-quick-panel'
import type {
  Permissions,
  PermissionType,
  PluginCategoryEnum,
} from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import DebugInfo from '@/app/components/plugins/plugin-page/debug-info'
import InstallPluginDropdown from '@/app/components/plugins/plugin-page/install-plugin-dropdown'
import PluginTasks from '@/app/components/plugins/plugin-page/plugin-tasks'
import { PermissionQuickPanel } from './permission-quick-panel'
import {
  integrationSidebarInactiveNavItemClassName,
  integrationSidebarNavItemClassName,
} from './sidebar-nav-item-styles'

type PermissionTooltipWrapperProps = {
  children: ReactNode
  className?: string
  content: string
  placement: 'top' | 'bottom'
  show: boolean
}

const permissionTooltipClassName = 'w-[112px] text-left'

function PermissionTooltipWrapper({
  children,
  className,
  content,
  placement,
  show,
}: PermissionTooltipWrapperProps) {
  const trigger = (
    <span aria-label={show ? content : undefined} className={cn('inline-flex', className)}>
      {children}
    </span>
  )

  if (!show) return trigger

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent placement={placement} sideOffset={8} className={permissionTooltipClassName}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export function IntegrationSidebarActions({
  canManagement,
  installContextCategory,
  onSwitchToMarketplace,
}: {
  canManagement: boolean
  installContextCategory?: PluginCategoryEnum
  onSwitchToMarketplace: () => void
}) {
  const { t } = useTranslation()

  return (
    <IntegrationSidebarInstallActions
      canManagement={canManagement}
      installContextCategory={installContextCategory}
      installLabel={t(($) => $.installAction, { ns: 'plugin' })}
      permissionTooltip={t(($) => $['privilege.noInstallPermissionTooltip'], { ns: 'plugin' })}
      onSwitchToMarketplace={onSwitchToMarketplace}
    />
  )
}

function IntegrationSidebarInstallActions({
  canManagement,
  installContextCategory,
  installLabel,
  permissionTooltip,
  onSwitchToMarketplace,
}: {
  canManagement: boolean
  installContextCategory?: PluginCategoryEnum
  installLabel: string
  permissionTooltip: string
  onSwitchToMarketplace: () => void
}) {
  const actionRowRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={actionRowRef} className="flex w-full shrink-0 items-center">
      <PermissionTooltipWrapper
        show={!canManagement}
        content={permissionTooltip}
        placement="bottom"
        className="min-w-0 flex-1"
      >
        <InstallPluginDropdown
          disabled={!canManagement}
          rootClassName="w-full"
          triggerVariant="primary"
          triggerClassName="h-8 min-w-0 justify-start gap-2 px-2.5 py-2 system-sm-medium transition-[width]"
          triggerLabel={installLabel}
          triggerOpenClassName="bg-components-button-primary-bg-hover"
          popupClassName="w-[200px]"
          installContextCategory={installContextCategory}
          showTriggerArrow={false}
          onSwitchToMarketplaceTab={onSwitchToMarketplace}
        />
      </PermissionTooltipWrapper>
      <PluginTasks
        animatedSlot
        dropdownAnchor={() => actionRowRef.current}
        dropdownPlacement="bottom-start"
      />
    </div>
  )
}

const sidebarUtilityActionClassName = cn(
  integrationSidebarNavItemClassName,
  integrationSidebarInactiveNavItemClassName,
  'justify-start border-none bg-transparent shadow-none',
)

export function IntegrationSidebarUtilityActions({
  canDebugger,
  permission,
  showPermissionQuickPanel,
  onPermissionChange,
}: {
  canDebugger: boolean
  permission?: Permissions
  showPermissionQuickPanel: boolean
  onPermissionChange: (key: PermissionSettingKey, value: PermissionType) => void
}) {
  const { t } = useTranslation()
  const debugLabel = t(($) => $['debugInfo.title'], { ns: 'plugin' })
  const permissionsLabel = t(($) => $['privilege.permissions'], { ns: 'plugin' })

  return (
    <div className="flex w-46 shrink-0 flex-col gap-px pt-2 pb-2.5">
      {canDebugger && (
        <DebugInfo
          popupPlacement="top-start"
          triggerVariant="ghost"
          triggerClassName={sidebarUtilityActionClassName}
          triggerContent={
            <>
              <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
                <span className="i-ri-bug-line size-4" />
              </span>
              <span className="min-w-0 truncate">{debugLabel}</span>
            </>
          }
        />
      )}
      {showPermissionQuickPanel && permission && (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                className={sidebarUtilityActionClassName}
                aria-label={permissionsLabel}
              >
                <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
                  <span className="i-ri-equalizer-2-line size-4" />
                </span>
                <span className="min-w-0 truncate">{permissionsLabel}</span>
              </Button>
            }
          />
          <PopoverContent
            placement="top-start"
            sideOffset={4}
            popupClassName="border-0 bg-transparent p-0 shadow-none"
          >
            <PermissionQuickPanel permission={permission} onChange={onPermissionChange} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
