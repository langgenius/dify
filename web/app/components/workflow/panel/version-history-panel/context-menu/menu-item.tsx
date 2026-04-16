import type { FC } from 'react'
import type { VersionHistoryContextMenuOptions } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

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
    <div
      className={cn(
        'flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5',
        isDestructive ? 'hover:bg-state-destructive-hover' : 'hover:bg-state-base-hover',
      )}
      onClick={() => {
        onClick(item.key)
      }}
    >
      <div className={cn(
        'flex-1 system-md-regular text-text-primary',
        isDestructive && 'hover:text-text-destructive',
      )}
      >
        {item.name}
      </div>
    </div>
  )
}

export default React.memo(MenuItem)
