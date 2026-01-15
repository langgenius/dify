import type { FC, ReactNode } from 'react'
import { RiFolder6Line, RiFolderOpenLine } from '@remixicon/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type FoldItemProps = {
  name: string
  prefix?: ReactNode
  active?: boolean
  open?: boolean
}

const FoldItem: FC<FoldItemProps> = ({ name, prefix, active = false, open = false }) => {
  const Icon = open ? RiFolderOpenLine : RiFolder6Line

  return (
    <div
      className={cn(
        'flex h-6 items-center rounded-md pl-2 pr-1.5 text-text-secondary',
        active && 'bg-state-base-active text-text-primary',
      )}
      data-component="fold-item"
    >
      {prefix}
      <div className="flex items-center gap-2 py-0.5">
        <Icon
          className={cn(
            'size-4',
            open ? 'text-primary-600' : 'text-text-secondary',
            active && 'text-text-primary',
          )}
        />
        <span className={cn('system-sm-regular', active && 'font-medium text-text-primary')}>
          {name}
        </span>
      </div>
    </div>
  )
}

export default React.memo(FoldItem)
