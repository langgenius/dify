'use client'
import type { Placement } from '@langgenius/dify-ui/dropdown-menu'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { PluginSource } from '../types'

type OperationDropdownProps = Readonly<{
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
  showCheckVersion?: boolean
  showRemove?: boolean
}>

export function OperationDropdown({
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
  showCheckVersion = true,
  showRemove = true,
}: OperationDropdownProps) {
  const { t } = useTranslation()
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const showInfo = source === PluginSource.github
  const showCheckVersionAction = showCheckVersion && source === PluginSource.github
  const showMarketplaceDetail = (source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace
  const showRemoveAction = showRemove
  const showSeparator = showRemoveAction && (showMarketplaceDetail || !!onViewReadme)

  if (!showInfo && !showCheckVersionAction && !showMarketplaceDetail && !onViewReadme && !showRemoveAction)
    return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn('action-btn data-popup-open:bg-state-base-hover', triggerSize === 'xs' ? 'action-btn-xs' : 'action-btn-m')}
        aria-label={t('detailPanel.operation.moreActions', { ns: 'plugin' })}
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName={cn('w-[192px] py-1', popupClassName)}
      >
        {showInfo && (
          <DropdownMenuItem className="px-2 py-1 system-md-regular text-text-secondary" onClick={onInfo}>
            <span className="min-w-0 grow truncate px-1 py-0.5">{t('detailPanel.operation.info', { ns: 'plugin' })}</span>
          </DropdownMenuItem>
        )}
        {showCheckVersionAction && (
          <DropdownMenuItem className="px-2 py-1 system-md-regular text-text-secondary" onClick={onCheckVersion}>
            <span className="min-w-0 grow truncate px-1 py-0.5">{t('detailPanel.operation.checkUpdate', { ns: 'plugin' })}</span>
          </DropdownMenuItem>
        )}
        {showMarketplaceDetail && (
          <DropdownMenuLinkItem
            className="px-2 py-1 system-md-regular text-text-secondary"
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('detailPanel.operation.viewDetail', { ns: 'plugin' })}
          >
            <span className="min-w-0 grow truncate px-1 py-0.5">{t('detailPanel.operation.viewDetail', { ns: 'plugin' })}</span>
            <span className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-tertiary" />
          </DropdownMenuLinkItem>
        )}
        {onViewReadme && (
          <DropdownMenuItem className="px-2 py-1 system-md-regular text-text-secondary" onClick={onViewReadme}>
            <span className="min-w-0 grow truncate px-1 py-0.5">{t('detailPanel.operation.viewReadme', { ns: 'plugin' })}</span>
          </DropdownMenuItem>
        )}
        {showSeparator && (
          <DropdownMenuSeparator />
        )}
        {showRemoveAction && (
          <DropdownMenuItem
            className={cn(
              'px-2 py-1 system-md-regular text-text-secondary',
              destructiveRemove && 'data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive',
            )}
            onClick={onRemove}
          >
            <span className={cn('min-w-0 grow truncate px-1 py-0.5', destructiveRemove && 'text-inherit')}>
              {t('detailPanel.operation.remove', { ns: 'plugin' })}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
