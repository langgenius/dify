'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
type Props = {
  className?: string
  icon: React.JSX.Element
  name: string
  description: string
  children: React.JSX.Element
}

const ItemPanel: FC<Props> = ({
  className,
  icon,
  name,
  description,
  children,
}) => {
  return (
    <div className={cn(className, 'flex h-12 items-center justify-between rounded-lg bg-background-section-burn px-3')}>
      <div className='flex items-center'>
        {icon}
        <div className='ml-3 mr-1 text-sm font-semibold leading-6 text-text-secondary'>{name}</div>
        <Tooltip
          popupContent={
            <div className='w-[180px]'>
              {description}
            </div>
          }
        >
        </Tooltip>
      </div>
      <div>
        {children}
      </div>
    </div>
  )
}
export default React.memo(ItemPanel)
