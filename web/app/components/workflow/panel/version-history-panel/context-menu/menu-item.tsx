import type { FC } from 'react'
import type { VersionHistoryContextMenuOptions } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { DropdownMenuItem } from '@/app/components/base/ui/dropdown-menu'

type MenuItemProps = {
  item: {
    key: VersionHistoryContextMenuOptions
    name: string
  }
  onClick: (operation: VersionHistoryContextMenuOptions) => void
  isDestructive?: boolean
}

const MenuItem: FC<MenuItemProps> = ({
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

export default React.memo(MenuItem)
