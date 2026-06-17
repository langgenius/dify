'use client'
import type { Placement } from '@langgenius/dify-ui/dropdown-menu'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { PluginSource } from '../types'

type Props = Readonly<{
  source: PluginSource
  onInfo: () => void
  onCheckVersion: () => void
  onRemove: () => void
  onViewReadme?: () => void
  detailUrl: string
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  popupClassName?: string
  triggerSize?: 'm' | 'xs'
  destructiveRemove?: boolean
}>

const operationMenuPopupClassName = 'w-[192px] py-1'
const operationMenuItemClassName = 'px-2 py-1 text-text-secondary system-md-regular'
const operationMenuLabelClassName = 'min-w-0 grow truncate px-1 py-0.5'

const OperationDropdown: FC<Props> = ({
  source,
  detailUrl,
  onInfo,
  onCheckVersion,
  onRemove,
  onViewReadme,
  placement = 'bottom-end',
  sideOffset = 4,
  alignOffset = 0,
  popupClassName,
  triggerSize = 'm',
  destructiveRemove = false,
}) => {
  const { t } = useTranslation()
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn('action-btn data-popup-open:bg-state-base-hover', triggerSize === 'xs' ? 'action-btn-xs' : 'action-btn-m')}
      >
        <span className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName={cn(operationMenuPopupClassName, popupClassName)}
      >
        {source === PluginSource.github && (
          <DropdownMenuItem className={operationMenuItemClassName} onClick={onInfo}>
            <span className={operationMenuLabelClassName}>{t('detailPanel.operation.info', { ns: 'plugin' })}</span>
          </DropdownMenuItem>
        )}
        {source === PluginSource.github && (
          <DropdownMenuItem className={operationMenuItemClassName} onClick={onCheckVersion}>
            <span className={operationMenuLabelClassName}>{t('detailPanel.operation.checkUpdate', { ns: 'plugin' })}</span>
          </DropdownMenuItem>
        )}
        {(source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace && (
          <DropdownMenuItem className={operationMenuItemClassName} render={<a href={detailUrl} target="_blank" rel="noopener noreferrer" />}>
            <span className={operationMenuLabelClassName}>{t('detailPanel.operation.viewDetail', { ns: 'plugin' })}</span>
            <span className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-tertiary" />
          </DropdownMenuItem>
        )}
        {onViewReadme && (
          <DropdownMenuItem className={operationMenuItemClassName} onClick={onViewReadme}>
            <span className={operationMenuLabelClassName}>{t('detailPanel.operation.viewReadme', { ns: 'plugin' })}</span>
          </DropdownMenuItem>
        )}
        {(source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace && (
          <DropdownMenuSeparator className="my-0" />
        )}
        <DropdownMenuItem
          className={cn(
            operationMenuItemClassName,
            destructiveRemove && 'data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive',
          )}
          onClick={onRemove}
        >
          <span className={cn(operationMenuLabelClassName, destructiveRemove && 'text-inherit')}>
            {t('detailPanel.operation.remove', { ns: 'plugin' })}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(OperationDropdown)
