'use client'
import type { FC } from 'react'
import React from 'react'
import Tooltip from '@/app/components/base/tooltip'

export const Item: FC<{ title: string; tooltip: string; children: React.JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className='mb-1 flex items-center space-x-1'>
        <div className='system-sm-semibold text-text-secondary py-1'>{title}</div>
        <Tooltip
          popupContent={
            <div className='system-sm-regular text-text-secondary max-w-[200px]'>{tooltip}</div>
          }
        />
      </div>
      <div>{children}</div>
    </div>
  )
}
