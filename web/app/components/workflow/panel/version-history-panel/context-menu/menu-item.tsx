import React, { type FC } from 'react'
import type { VersionHistoryContextMenuOptions } from '../../../types'
import cn from '@/utils/classnames'

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
        'flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 ',
        isDestructive ? 'hover:bg-state-destructive-hover' : 'hover:bg-state-base-hover',
      )}
      onClick={() => {
        onClick(item.key)
      }}
    >
      <div className={cn(
        'system-md-regular flex-1 text-text-primary',
        isDestructive && 'hover:text-text-destructive',
      )}>
        {item.name}
      </div>
    </div>
  )
}

export default React.memo(MenuItem)
