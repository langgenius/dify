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
    showUpgrade?: boolean
  }
  onClick: (operation: VersionHistoryContextMenuOptions) => void
  isDestructive?: boolean
}

const ActionMenuItem: FC<ActionMenuItemProps> = ({
  item,
  onClick,
  isDestructive = false,
}) => {
  return (
    <DropdownMenuItem
      variant={isDestructive ? 'destructive' : 'default'}
      className={cn(
        'justify-between gap-x-3 px-2 py-1.5 whitespace-nowrap',
        isDestructive && 'data-highlighted:bg-state-destructive-hover',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick(item.key)
      }}
    >
      <div className={cn(
        'flex-1 system-md-regular whitespace-nowrap text-text-primary',
        isDestructive && 'text-inherit',
      )}
      >
        {item.name}
      </div>
      {item.showUpgrade && (
        <div
          className="shrink-0"
          onClick={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
        >
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
