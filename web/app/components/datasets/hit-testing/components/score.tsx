'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  value: number
}

const Score: FC<Props> = ({
  value,
}) => {
  return (
    <div className='relative items-center px-[5px] rounded-md border border-components-progress-bar-border overflow-hidden'>
      <div className='absolute top-0 left-0 h-full bg-util-colors-blue-brand-blue-brand-100 border-r-[1.5px] border-components-progress-brand-progress ' style={{ width: `${value * 100}%` }} />
      <div className='relative flex items-center h-4 space-x-0.5 text-util-colors-blue-brand-blue-brand-700'>
        <div className='system-2xs-medium-uppercase'>score</div>
        <div className='system-xs-semibold'>{value.toFixed(2)}</div>
      </div>
    </div>
  )
}
export default React.memo(Score)
