'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEqualizer2Line,
  RiErrorWarningFill,
} from '@remixicon/react'
import { Group } from '@/app/components/base/icons/src/vender/other'
import AppIcon from '@/app/components/base/app-icon'
import Switch from '@/app/components/base/switch'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import { ToolTipContent } from '@/app/components/base/tooltip/content'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { SwitchPluginVersion } from '@/app/components/workflow/nodes/_base/components/switch-plugin-version'
import cn from '@/utils/classnames'

type Props = {
  icon?: any
  providerName?: string
  toolLabel?: string
  showSwitch?: boolean
  switchValue?: boolean
  onSwitchChange?: (value: boolean) => void
  onDelete?: () => void
  noAuth?: boolean
  onAuth?: () => void
  isError?: boolean
  errorTip?: any
  uninstalled?: boolean
  installInfo?: string
  onInstall?: () => void
  versionMismatch?: boolean
  open: boolean
}

const ToolItem = ({
  open,
  icon,
  providerName,
  toolLabel,
  showSwitch,
  switchValue,
  onSwitchChange,
  onDelete,
  noAuth,
  onAuth,
  uninstalled,
  installInfo,
  onInstall,
  isError,
  errorTip,
  versionMismatch,
}: Props) => {
  const { t } = useTranslation()
  const providerNameText = providerName?.split('/').pop()
  const isTransparent = uninstalled || versionMismatch || isError
  const [isDeleting, setIsDeleting] = useState(false)

  return (
    <div className={cn(
      'bg-components-panel-on-panel-item-bg border-components-panel-border-subtle shadow-xs hover:bg-components-panel-on-panel-item-bg-hover group flex cursor-default items-center gap-1 rounded-lg border-[0.5px] p-1.5 pr-2 hover:shadow-sm',
      open && 'bg-components-panel-on-panel-item-bg-hover shadow-sm',
      isDeleting && 'hover:bg-state-destructive-hover border-state-destructive-border shadow-xs',
    )}>
      {icon && (
        <div className={cn('shrink-0', isTransparent && 'opacity-50')}>
          {typeof icon === 'string' && <div className='border-components-panel-border-subtle bg-background-default-dodge h-7 w-7 rounded-lg border-[0.5px] bg-cover bg-center' style={{ backgroundImage: `url(${icon})` }} />}
          {typeof icon !== 'string' && <AppIcon className='border-components-panel-border-subtle bg-background-default-dodge h-7 w-7 rounded-lg border-[0.5px]' size='xs' icon={icon?.content} background={icon?.background} />}
        </div>
      )}
      {!icon && (
        <div className={cn(
          'border-components-panel-border-subtle bg-background-default-subtle flex h-7 w-7 items-center justify-center rounded-md border-[0.5px]',
        )}>
          <div className='flex h-5 w-5 items-center justify-center opacity-35'>
            <Group className='text-text-tertiary' />
          </div>
        </div>
      )}
      <div className={cn('grow truncate pl-0.5', isTransparent && 'opacity-50')}>
        <div className='text-text-tertiary system-2xs-medium-uppercase'>{providerNameText}</div>
        <div className='text-text-secondary system-xs-medium'>{toolLabel}</div>
      </div>
      <div className='hidden items-center gap-1 group-hover:flex'>
        {!noAuth && !isError && !uninstalled && !versionMismatch && (
          <ActionButton>
            <RiEqualizer2Line className='h-4 w-4' />
          </ActionButton>
        )}
        <div
          className='text-text-tertiary hover:text-text-destructive cursor-pointer rounded-md p-1'
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.()
          }}
          onMouseOver={() => setIsDeleting(true)}
          onMouseLeave={() => setIsDeleting(false)}
        >
          <RiDeleteBinLine className='h-4 w-4' />
        </div>
      </div>
      {!isError && !uninstalled && !noAuth && !versionMismatch && showSwitch && (
        <div className='mr-1' onClick={e => e.stopPropagation()}>
          <Switch
            size='md'
            defaultValue={switchValue}
            onChange={onSwitchChange}
          />
        </div>
      )}
      {!isError && !uninstalled && !versionMismatch && noAuth && (
        <Button variant='secondary' size='small' onClick={onAuth}>
          {t('tools.notAuthorized')}
          <Indicator className='ml-2' color='orange' />
        </Button>
      )}
      {!isError && !uninstalled && versionMismatch && installInfo && (
        <div onClick={e => e.stopPropagation()}>
          <SwitchPluginVersion
            className='-mt-1'
            uniqueIdentifier={installInfo}
            tooltip={
              <ToolTipContent
                title={t('plugin.detailPanel.toolSelector.unsupportedTitle')}
              >
                {`${t('plugin.detailPanel.toolSelector.unsupportedContent')} ${t('plugin.detailPanel.toolSelector.unsupportedContent2')}`}
              </ToolTipContent>
            }
            onChange={() => {
              onInstall?.()
            }}
          />
        </div>
      )}
      {!isError && uninstalled && installInfo && (
        <InstallPluginButton
          onClick={e => e.stopPropagation()}
          size={'small'}
          uniqueIdentifier={installInfo}
          onSuccess={() => {
            onInstall?.()
          }}
        />
      )}
      {isError && (
        <Tooltip
          popupContent={errorTip}
          needsDelay
        >
          <div>
            <RiErrorWarningFill className='text-text-destructive h-4 w-4' />
          </div>
        </Tooltip>
      )}
    </div>
  )
}

export default ToolItem
