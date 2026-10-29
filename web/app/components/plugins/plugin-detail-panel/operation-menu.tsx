'use client'
import type { MenuContentProps } from '@langgenius/dify-ui/menu'
import type { MarketplacePluginRef } from '@/features/marketplace/links'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { useMarketplace } from '@/features/marketplace/client'
import useTheme from '@/hooks/use-theme'
import { PluginSource } from '../types'

type OperationMenuProps = Readonly<
  Pick<MenuContentProps, 'side' | 'align'> & {
    source: PluginSource
    marketplacePlugin?: MarketplacePluginRef
    repo?: string
    onInfo: () => void
    onCheckVersion: () => void
    onRemove: () => void
    onViewReadme?: () => void
    popupClassName?: string
    triggerSize?: 'm' | 'xs'
    triggerAriaLabel?: string
    destructiveRemove?: boolean
    showCheckVersion?: boolean
    showRemove?: boolean
  }
>

export function OperationMenu({
  source,
  marketplacePlugin,
  repo,
  onInfo,
  onCheckVersion,
  onRemove,
  onViewReadme,
  side,
  align,
  popupClassName,
  triggerSize = 'm',
  triggerAriaLabel,
  destructiveRemove = false,
  showCheckVersion = true,
  showRemove = true,
}: OperationMenuProps) {
  const { t } = useTranslation(['plugin'])
  const marketplace = useMarketplace()
  const locale = useLocale()
  const { theme } = useTheme()
  const showInfo = source === PluginSource.github
  const showCheckVersionAction = showCheckVersion && source === PluginSource.github
  const detailUrl = !marketplace
    ? undefined
    : source === PluginSource.marketplace && marketplacePlugin
      ? marketplace.plugin(marketplacePlugin, { language: locale, theme })
      : source === PluginSource.github && repo
        ? `https://github.com/${repo}`
        : undefined
  const showRemoveAction = showRemove
  const showSeparator = showRemoveAction && (!!detailUrl || !!onViewReadme)

  if (!showInfo && !showCheckVersionAction && !detailUrl && !onViewReadme && !showRemoveAction)
    return null

  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            aria-label={
              triggerAriaLabel ?? t(($) => $['detailPanel.operation.moreActions'], { ns: 'plugin' })
            }
            size={triggerSize === 'xs' ? 'xs' : 'md'}
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <MenuContent side={side} align={align} className={cn('w-48 py-1', popupClassName)}>
        {showInfo && (
          <MenuItem className="px-2 py-1 system-md-regular text-text-secondary" onClick={onInfo}>
            <span className="min-w-0 grow truncate px-1 py-0.5">
              {t(($) => $['detailPanel.operation.info'], { ns: 'plugin' })}
            </span>
          </MenuItem>
        )}
        {showCheckVersionAction && (
          <MenuItem
            className="px-2 py-1 system-md-regular text-text-secondary"
            onClick={onCheckVersion}
          >
            <span className="min-w-0 grow truncate px-1 py-0.5">
              {t(($) => $['detailPanel.operation.checkUpdate'], { ns: 'plugin' })}
            </span>
          </MenuItem>
        )}
        {detailUrl && (
          <MenuLinkItem
            className="px-2 py-1 system-md-regular text-text-secondary"
            href={detailUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="min-w-0 grow truncate px-1 py-0.5">
              {t(($) => $['detailPanel.operation.viewDetail'], { ns: 'plugin' })}
            </span>
            <span className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-tertiary" />
          </MenuLinkItem>
        )}
        {onViewReadme && (
          <MenuItem
            className="px-2 py-1 system-md-regular text-text-secondary"
            onClick={onViewReadme}
          >
            <span className="min-w-0 grow truncate px-1 py-0.5">
              {t(($) => $['detailPanel.operation.viewReadme'], { ns: 'plugin' })}
            </span>
          </MenuItem>
        )}
        {showSeparator && <MenuSeparator />}
        {showRemoveAction && (
          <MenuItem
            className={cn(
              'px-2 py-1 system-md-regular text-text-secondary',
              destructiveRemove &&
                'data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive',
            )}
            onClick={onRemove}
          >
            <span
              className={cn(
                'min-w-0 grow truncate px-1 py-0.5',
                destructiveRemove && 'text-inherit',
              )}
            >
              {t(($) => $['detailPanel.operation.remove'], { ns: 'plugin' })}
            </span>
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
