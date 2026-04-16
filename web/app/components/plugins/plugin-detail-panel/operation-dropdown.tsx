'use client'
import type { FC } from 'react'
import type { Placement } from '@/app/components/base/ui/placement'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { PluginSource } from '../types'

type Props = {
  source: PluginSource
  onInfo: () => void
  onCheckVersion: () => void
  onRemove: () => void
  detailUrl: string
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  popupClassName?: string
}

const OperationDropdown: FC<Props> = ({
  source,
  detailUrl,
  onInfo,
  onCheckVersion,
  onRemove,
  placement = 'bottom-end',
  sideOffset = 4,
  alignOffset = 0,
  popupClassName,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn('action-btn action-btn-m', open && 'bg-state-base-hover')}
      >
        <span className="i-ri-more-fill h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName={cn('w-auto min-w-[160px]', popupClassName)}
      >
        {source === PluginSource.github && (
          <DropdownMenuItem onClick={onInfo}>
            {t('detailPanel.operation.info', { ns: 'plugin' })}
          </DropdownMenuItem>
        )}
        {source === PluginSource.github && (
          <DropdownMenuItem onClick={onCheckVersion}>
            {t('detailPanel.operation.checkUpdate', { ns: 'plugin' })}
          </DropdownMenuItem>
        )}
        {(source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace && (
          <DropdownMenuItem render={<a href={detailUrl} target="_blank" rel="noopener noreferrer" />}>
            <span className="grow">{t('detailPanel.operation.viewDetail', { ns: 'plugin' })}</span>
            <span className="i-ri-arrow-right-up-line h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          </DropdownMenuItem>
        )}
        {(source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace && (
          <DropdownMenuSeparator />
        )}
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          {t('detailPanel.operation.remove', { ns: 'plugin' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(OperationDropdown)
