'use client'
import {
  RiDeleteBinLine,
  RiEqualizer2Line,
  RiErrorWarningFill,
} from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import { Group } from '@/app/components/base/icons/src/vender/other'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import { ToolTipContent } from '@/app/components/base/tooltip/content'
import Indicator from '@/app/components/header/indicator'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { useMCPToolAvailability } from '@/app/components/workflow/nodes/_base/components/mcp-tool-availability'
import McpToolNotSupportTooltip from '@/app/components/workflow/nodes/_base/components/mcp-tool-not-support-tooltip'
import { SwitchPluginVersion } from '@/app/components/workflow/nodes/_base/components/switch-plugin-version'
import { cn } from '@/utils/classnames'

type Props = {
  icon?: string | { content?: string, background?: string }
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
}

const ToolItem = ({
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

  return (
    <div className={cn(
      'group flex cursor-default items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-1.5 pr-2 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
      open && 'bg-components-panel-on-panel-item-bg-hover shadow-sm',
      isDeleting && 'border-state-destructive-border shadow-xs hover:bg-state-destructive-hover',
    )}
    >
      {icon && (
        <div className={cn('shrink-0', isTransparent && 'opacity-50', isShowCanNotChooseMCPTip && 'opacity-30')}>
          {typeof icon === 'string' && <div className="h-7 w-7 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge bg-cover bg-center" style={{ backgroundImage: `url(${icon})` }} />}
          {typeof icon !== 'string' && <AppIcon className="h-7 w-7 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge" size="xs" icon={icon?.content} background={icon?.background} />}
        </div>
      )}
      {!icon && (
        <div className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle',
          isTransparent && 'opacity-50',
          isShowCanNotChooseMCPTip && 'opacity-30',
        )}
        >
          <div className="flex h-5 w-5 items-center justify-center opacity-35">
            <Group className="text-text-tertiary" />
          </div>
        </div>
      )}
      <div className={cn('grow truncate pl-0.5', isTransparent && 'opacity-50', isShowCanNotChooseMCPTip && 'opacity-30')}>
        <div className="system-2xs-medium-uppercase text-text-tertiary">{providerNameText}</div>
        <div className="system-xs-medium text-text-secondary">{toolLabel}</div>
      </div>
      <div className="hidden items-center gap-1 group-hover:flex">
        {!noAuth && !isError && !uninstalled && !versionMismatch && !isShowCanNotChooseMCPTip && (
          <ActionButton>
            <RiEqualizer2Line className="h-4 w-4" />
          </ActionButton>
        )}
        <div
          className="cursor-pointer rounded-md p-1 text-text-tertiary hover:text-text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.()
          }}
          onMouseOver={() => setIsDeleting(true)}
          onMouseLeave={() => setIsDeleting(false)}
        >
          <RiDeleteBinLine className="h-4 w-4" />
        </div>
      </div>
      {!isError && !uninstalled && !noAuth && !versionMismatch && !isShowCanNotChooseMCPTip && showSwitch && (
        <div className="mr-1" onClick={e => e.stopPropagation()}>
          <Switch
            size="md"
            defaultValue={switchValue}
            onChange={onSwitchChange}
          />
        </div>
      )}
      {isShowCanNotChooseMCPTip && <McpToolNotSupportTooltip />}
      {!isError && !uninstalled && !versionMismatch && noAuth && (
        <Button variant="secondary" size="small">
          {t('notAuthorized', { ns: 'tools' })}
          <Indicator className="ml-2" color="orange" />
        </Button>
      )}
      {!isError && !uninstalled && !versionMismatch && authRemoved && (
        <Button variant="secondary" size="small">
          {t('auth.authRemoved', { ns: 'plugin' })}
          <Indicator className="ml-2" color="red" />
        </Button>
      )}
      {!isError && !uninstalled && versionMismatch && installInfo && (
        <div onClick={e => e.stopPropagation()}>
          <SwitchPluginVersion
            className="-mt-1"
            uniqueIdentifier={installInfo}
            tooltip={(
              <ToolTipContent
                title={t('detailPanel.toolSelector.unsupportedTitle', { ns: 'plugin' })}
              >
                {`${t('detailPanel.toolSelector.unsupportedContent', { ns: 'plugin' })} ${t('detailPanel.toolSelector.unsupportedContent2', { ns: 'plugin' })}`}
              </ToolTipContent>
            )}
            onChange={() => {
              onInstall?.()
            }}
          />
        </div>
      )}
      {!isError && uninstalled && installInfo && (
        <InstallPluginButton
          onClick={e => e.stopPropagation()}
          size="small"
          uniqueIdentifier={installInfo}
          onSuccess={() => {
            onInstall?.()
          }}
        />
      )}
      {isError && (
        <Tooltip
          popupContent={errorTip}
        >
          <div>
            <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
          </div>
        </Tooltip>
      )}
    </div>
  )
}

export default ToolItem
