import type { FC } from 'react'
import type { VersionHistoryContextMenuOptions } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { DropdownMenuItem } from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'

type ActionMenuItemProps = {
  item: {
    key: VersionHistoryContextMenuOptions
    name: string
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
        'justify-between px-2 py-1.5',
        isDestructive && 'data-highlighted:bg-state-destructive-hover',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick(item.key)
      }}
    >
      <div className={cn(
        'flex-1 system-md-regular text-text-primary',
        isDestructive && 'text-inherit',
      )}
      >
        {item.name}
      </div>
    </DropdownMenuItem>
  )
}

export default React.memo(ActionMenuItem)
