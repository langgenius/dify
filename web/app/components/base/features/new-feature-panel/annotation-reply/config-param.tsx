'use client'
import type { FC } from 'react'
import React from 'react'
import Tooltip from '@/app/components/base/tooltip'

export const Item: FC<{ title: string; tooltip: string; children: JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className='flex items-center space-x-1 mb-1'>
        <div className='py-1 system-sm-semibold text-text-secondary'>{title}</div>
        <Tooltip
          popupContent={
            <div className='max-w-[200px] system-sm-regular text-text-secondary'>{tooltip}</div>
          }
        />
      </div>
      <div>{children}</div>
    </div>
  )
}
