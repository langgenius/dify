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
      <div className='flex items-center space-x-1'>
        <div>{title}</div>
        <Tooltip
          popupContent={
            <div className='max-w-[200px] leading-[18px] text-[13px] font-medium text-gray-800'>{tooltip}</div>
          }
        />
      </div>
      <div>{children}</div>
    </div>
  )
}
