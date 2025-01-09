'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

type Props = {
  value: number | null
  besideChunkName?: boolean
}

const Score: FC<Props> = ({
  value,
  besideChunkName,
}) => {
  if (!value || isNaN(value))
    return null
  return (
    <div className={cn('relative items-center px-[5px] border border-components-progress-bar-border overflow-hidden',
      besideChunkName ? 'border-l-0 h-[20.5px]' : 'h-[20px] rounded-md')}>
      <div className={cn('absolute top-0 left-0 h-full bg-util-colors-blue-brand-blue-brand-100 border-r-[1.5px] border-components-progress-brand-progress', value === 1 && 'border-r-0')} style={{ width: `${value * 100}%` }} />
      <div className={cn('relative flex items-center h-full space-x-0.5 text-util-colors-blue-brand-blue-brand-700')}>
        <div className='system-2xs-medium-uppercase'>score</div>
        <div className='system-xs-semibold'>{value?.toFixed(2)}</div>
      </div>
    </div>
  )
}
export default React.memo(Score)
