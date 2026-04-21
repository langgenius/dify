'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

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
    <div className={cn('relative items-center overflow-hidden border border-components-progress-bar-border px-[5px]', besideChunkName ? 'h-[20.5px] border-l-0' : 'h-[20px] rounded-md')}>
      <div className={cn('absolute top-0 left-0 h-full border-r-[1.5px] border-components-progress-brand-progress bg-util-colors-blue-brand-blue-brand-100', value === 1 && 'border-r-0')} style={{ width: `${value * 100}%` }} />
      <div className={cn('relative flex h-full items-center space-x-0.5 text-util-colors-blue-brand-blue-brand-700')}>
        <div className="system-2xs-medium-uppercase">score</div>
        <div className="system-xs-semibold">{value?.toFixed(2)}</div>
      </div>
    </div>
  )
}
export default React.memo(Score)
