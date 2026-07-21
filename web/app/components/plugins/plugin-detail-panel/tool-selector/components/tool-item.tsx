'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { useMCPToolAvailability } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import McpToolNotSupportTooltip from '@/app/components/workflow/nodes/_base/components/mcp-tool-not-support-tooltip'
import { SwitchPluginVersion } from '@/app/components/workflow/nodes/_base/components/switch-plugin-version'

type Props = Readonly<{
  triggerLabel?: string
  icon?: string | { content?: string; background?: string }
  providerName?: string
  isMCPTool?: boolean
  providerShowName?: string
  toolLabel?: string
  showSwitch?: boolean
  switchValue?: boolean
  onSwitchChange?: (value: boolean) => void
  onDelete?: () => void
  noAuth?: boolean
  isError?: boolean
  errorTip?: React.ReactNode
  uninstalled?: boolean
  installInfo?: string
  onInstall?: () => void
  versionMismatch?: boolean
  open: boolean
  authRemoved?: boolean
}>

const ToolItem = ({
  triggerLabel,
  open,
  icon,
  isMCPTool,
  providerShowName,
  providerName,
  toolLabel,
  showSwitch,
  switchValue,
  onSwitchChange,
  onDelete,
  noAuth,
  uninstalled,
  installInfo,
  onInstall,
  isError,
  errorTip,
  versionMismatch,
  authRemoved,
}: Props) => {
  const { t } = useTranslation()
  const { allowed: isMCPToolAllowed } = useMCPToolAvailability()
  const providerNameText = isMCPTool ? providerShowName : providerName?.split('/').pop()
  const isTransparent = uninstalled || versionMismatch || isError
  const [isDeleting, setIsDeleting] = useState(false)
  const isShowCanNotChooseMCPTip = isMCPTool && !isMCPToolAllowed
  const accessibleTriggerLabel =
    triggerLabel ||
    toolLabel ||
    t(($) => $['detailPanel.toolSelector.toolSetting'], { ns: 'plugin' })

  return (
    <div
      className={cn(
        'group relative flex items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-1.5 pr-2 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
        open && 'bg-components-panel-on-panel-item-bg-hover shadow-sm',
        isDeleting && 'border-state-destructive-border shadow-xs hover:bg-state-destructive-hover',
      )}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={accessibleTriggerLabel}
            className="absolute inset-0 z-0 cursor-pointer rounded-lg border-0 bg-transparent outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          />
        }
      />
      {icon && (
        <div
          className={cn(
            'pointer-events-none relative z-1 shrink-0',
            isTransparent && 'opacity-50',
            isShowCanNotChooseMCPTip && 'opacity-30',
          )}
        >
          {typeof icon === 'string' && (
            <div
              className="h-7 w-7 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge bg-cover bg-center"
              style={{ backgroundImage: `url(${icon})` }}
            />
          )}
          {typeof icon !== 'string' && (
            <AppIcon
              className="h-7 w-7 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge"
              size="xs"
              icon={icon?.content}
              background={icon?.background}
            />
          )}
        </div>
      )}
      {!icon && (
        <div
          className={cn(
            'pointer-events-none relative z-1 flex h-7 w-7 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle',
            isTransparent && 'opacity-50',
            isShowCanNotChooseMCPTip && 'opacity-30',
          )}
        >
          <div className="flex size-5 items-center justify-center opacity-35">
            <span className="i-custom-vender-other-group text-text-tertiary" />
          </div>
        </div>
      )}
      <div
        className={cn(
          'pointer-events-none relative z-1 grow truncate pl-0.5',
          isTransparent && 'opacity-50',
          isShowCanNotChooseMCPTip && 'opacity-30',
        )}
      >
        <div className="system-2xs-medium-uppercase text-text-tertiary">{providerNameText}</div>
        <div className="system-xs-medium text-text-secondary">{toolLabel}</div>
      </div>
      <div className="relative z-10 hidden items-center gap-1 group-focus-within:flex group-hover:flex">
        {!noAuth && !isError && !uninstalled && !versionMismatch && !isShowCanNotChooseMCPTip && (
          <span
            className="pointer-events-none flex size-6 items-center justify-center text-text-tertiary"
            aria-hidden
          >
            <span className="i-ri-equalizer-2-line size-4" />
          </span>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="small"
            aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
            className="size-6 min-h-0 p-0 text-text-tertiary hover:text-text-destructive"
            onClick={onDelete}
            onMouseEnter={() => setIsDeleting(true)}
            onMouseLeave={() => setIsDeleting(false)}
          >
            <span className="i-ri-delete-bin-line size-4" aria-hidden />
          </Button>
        )}
      </div>
      {!isError &&
        !uninstalled &&
        !noAuth &&
        !versionMismatch &&
        !isShowCanNotChooseMCPTip &&
        showSwitch && (
          <div className="relative z-10 mr-1">
            <Switch size="md" checked={switchValue ?? false} onCheckedChange={onSwitchChange} />
          </div>
        )}
      {isShowCanNotChooseMCPTip && (
        <div className="relative z-10">
          <McpToolNotSupportTooltip />
        </div>
      )}
      {!isError && !uninstalled && !versionMismatch && noAuth && (
        <PopoverTrigger
          render={
            <Button className="relative z-10" variant="secondary" size="small">
              {t(($) => $.notAuthorized, { ns: 'tools' })}
              <StatusDot className="ml-2" status="warning" />
            </Button>
          }
        />
      )}
      {!isError && !uninstalled && !versionMismatch && authRemoved && (
        <PopoverTrigger
          render={
            <Button className="relative z-10" variant="secondary" size="small">
              {t(($) => $['auth.authRemoved'], { ns: 'plugin' })}
              <StatusDot className="ml-2" status="error" />
            </Button>
          }
        />
      )}
      {!isError && !uninstalled && versionMismatch && installInfo && (
        <div className="relative z-10">
          <SwitchPluginVersion
            className="-mt-1"
            uniqueIdentifier={installInfo}
            tooltip={
              <div className="w-45" data-testid="tooltip-content">
                <div
                  className="mb-1.5 font-semibold text-text-secondary"
                  data-testid="tooltip-content-title"
                >
                  {t(($) => $['detailPanel.toolSelector.unsupportedTitle'], { ns: 'plugin' })}
                </div>
                <div className="mb-1.5 text-text-tertiary" data-testid="tooltip-content-body">
                  {`${t(($) => $['detailPanel.toolSelector.unsupportedContent'], { ns: 'plugin' })} ${t(($) => $['detailPanel.toolSelector.unsupportedContent2'], { ns: 'plugin' })}`}
                </div>
              </div>
            }
            onChange={() => {
              onInstall?.()
            }}
          />
        </div>
      )}
      {!isError && uninstalled && installInfo && (
        <div className="relative z-10">
          <InstallPluginButton
            size="small"
            uniqueIdentifier={installInfo}
            onSuccess={() => {
              onInstall?.()
            }}
          />
        </div>
      )}
      {isError && (
        <div className="relative z-10">
          <Popover>
            <PopoverTrigger
              openOnHover
              aria-label={
                typeof errorTip === 'string'
                  ? errorTip
                  : t(($) => $['detailPanel.toolSelector.unsupportedTitle'], { ns: 'plugin' })
              }
              className="inline-flex border-0 bg-transparent p-0"
            >
              <span className="i-ri-error-warning-fill size-4 text-text-destructive" />
            </PopoverTrigger>
            <PopoverContent popupClassName="px-3 py-2 system-xs-regular text-text-tertiary">
              {errorTip}
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  )
}

export default ToolItem
