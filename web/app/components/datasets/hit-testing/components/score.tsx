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
    <div className={cn('border-components-progress-bar-border relative items-center overflow-hidden border px-[5px]',
      besideChunkName ? 'h-[20.5px] border-l-0' : 'h-[20px] rounded-md')}>
      <div className={cn('bg-util-colors-blue-brand-blue-brand-100 border-components-progress-brand-progress absolute left-0 top-0 h-full border-r-[1.5px]', value === 1 && 'border-r-0')} style={{ width: `${value * 100}%` }} />
      <div className={cn('text-util-colors-blue-brand-blue-brand-700 relative flex h-full items-center space-x-0.5')}>
        <div className='system-2xs-medium-uppercase'>score</div>
        <div className='system-xs-semibold'>{value?.toFixed(2)}</div>
      </div>
    </div>
  )
}
export default React.memo(Score)
