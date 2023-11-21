'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  className?: string
  icon: JSX.Element
  name: string
  tooltip: string
  usage: number
  total: number
  unit?: string
}

const UsageInfo: FC<Props> = ({
  className,
  icon,
  name,
  tooltip,
  usage,
  total,
  unit,
}) => {
  return (
    <div className={className}>
      <div className='flex justify-between h-5 items-center'>
        <div className='flex items-center'>
          {icon}
          <div className='mx-1'>{name}</div>
          <div>{tooltip}</div>
        </div>
        <div className='flex items-center'>
          <div className='text-gray-500 text-sm'>{usage}</div>
          <div className='text-gray-500 text-sm'>/</div>
          <div className='text-gray-500 text-sm'>{total}</div>
          <div className='text-gray-500 text-sm'>{unit}</div>
        </div>
      </div>
      <div>
          Progress
      </div>
    </div>
  )
}
export default React.memo(UsageInfo)
