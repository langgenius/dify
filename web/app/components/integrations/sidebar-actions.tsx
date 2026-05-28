'use client'

import type { ReactNode } from 'react'
import type { PermissionSettingKey } from './permission-quick-panel'
import type { Permissions, PermissionType, PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import DebugInfo from '@/app/components/plugins/plugin-page/debug-info'
import InstallPluginDropdown from '@/app/components/plugins/plugin-page/install-plugin-dropdown'
import { PermissionQuickPanel } from './permission-quick-panel'

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
    <span
      aria-label={show ? content : undefined}
      className={cn('inline-flex', className)}
    >
      {children}
    </span>
  )

  if (!show)
    return trigger

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent placement={placement} sideOffset={8} className={permissionTooltipClassName}>{content}</TooltipContent>
    </Tooltip>
  )
}

export function IntegrationSidebarActions({
  canDebugger,
  canManagement,
  installContextCategory,
  permission,
  showPermissionQuickPanel,
  onPermissionChange,
  onSwitchToMarketplace,
}: {
  canDebugger: boolean
  canManagement: boolean
  installContextCategory?: PluginCategoryEnum
  permission?: Permissions
  showPermissionQuickPanel: boolean
  onPermissionChange: (key: PermissionSettingKey, value: PermissionType) => void
  onSwitchToMarketplace: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mt-6 flex shrink-0 items-center gap-1">
      <PermissionTooltipWrapper
        show={!canManagement}
        content={t('privilege.noInstallPermissionTooltip', { ns: 'plugin' })}
        placement="bottom"
        className="min-w-0 flex-1"
      >
        <InstallPluginDropdown
          disabled={!canManagement}
          rootClassName="w-full"
          triggerVariant="primary"
          triggerClassName="h-8 min-w-0 gap-0.5 p-2 system-sm-medium"
          triggerLabel={t('installAction', { ns: 'plugin' })}
          triggerOpenClassName="bg-components-button-primary-bg-hover"
          popupClassName="w-[240px] rounded-2xl py-2 shadow-xl"
          installContextCategory={installContextCategory}
          onSwitchToMarketplaceTab={onSwitchToMarketplace}
        />
      </PermissionTooltipWrapper>
      <PermissionTooltipWrapper
        show={!canDebugger}
        content={t('privilege.noDebugPermissionTooltip', { ns: 'plugin' })}
        placement="top"
        className="size-8 shrink-0"
      >
        {canDebugger
          ? (
              <DebugInfo />
            )
          : (
              <Button
                variant="secondary"
                disabled
                className="h-full w-full p-0"
                aria-label={t('debugInfo.title', { ns: 'plugin' })}
                title={t('debugInfo.title', { ns: 'plugin' })}
              >
                <span aria-hidden className="i-ri-bug-line size-4" />
              </Button>
            )}
      </PermissionTooltipWrapper>
      <Popover>
        <PopoverTrigger
          render={(
            <Button
              variant="secondary"
              disabled={!showPermissionQuickPanel}
              className="size-8 shrink-0 p-0"
              aria-label={t('privilege.permissions', { ns: 'plugin' })}
              title={t('privilege.permissions', { ns: 'plugin' })}
            >
              <span aria-hidden className="i-ri-equalizer-2-line size-4" />
            </Button>
          )}
        />
        {showPermissionQuickPanel && permission && (
          <PopoverContent
            placement="bottom-start"
            sideOffset={4}
            popupClassName="border-0 bg-transparent p-0 shadow-none"
          >
            <PermissionQuickPanel
              permission={permission}
              onChange={onPermissionChange}
            />
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
