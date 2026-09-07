import type { FC } from 'react'
import type { VersionHistoryContextMenuOptions } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { DropdownMenuItem } from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'

type ActionMenuItemProps = {
  item: {
    key: VersionHistoryContextMenuOptions
    name: string
    description?: string
    showUpgrade?: boolean
  }
  onClick: (operation: VersionHistoryContextMenuOptions) => void
  isDestructive?: boolean
}

const ActionMenuItem: FC<ActionMenuItemProps> = ({ item, onClick, isDestructive = false }) => {
  return (
    <DropdownMenuItem
      variant={isDestructive ? 'destructive' : 'default'}
      className={cn(
        'justify-between gap-x-3 px-2 py-1.5 whitespace-nowrap',
        item.description && 'h-auto py-1',
        isDestructive && 'data-highlighted:bg-state-destructive-hover',
      )}
      onClick={(event) => {
        event.stopPropagation()
        const target = event.target
        if (target instanceof Element && target.closest('[data-upgrade-action]')) return

        onClick(item.key)
      }}
    >
      <div
        className={cn(
          'min-w-0 flex-1 px-1 py-0.5 system-md-regular whitespace-nowrap text-text-primary',
          item.description && 'flex flex-col gap-y-0.5 text-text-secondary',
          isDestructive && 'text-inherit',
        )}
      >
        <div className="w-full truncate">{item.name}</div>
        {item.description && (
          <div
            className="w-full max-w-38 truncate system-2xs-regular text-text-tertiary"
            title={item.description}
          >
            {item.description}
          </div>
        )}
      </div>
      {item.showUpgrade && (
        <div data-upgrade-action className="shrink-0">
          <UpgradeBtn
            size="custom"
            isShort
            loc="workflow-version-history-menu"
            className="h-5! rounded-md! px-1!"
          />
        </div>
      )}
    </DropdownMenuItem>
  )
}

export default React.memo(ActionMenuItem)
