'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'

type ScoreProps = {
  readonly value: number | null
  readonly besideChunkName?: boolean
}

export const Score = memo(({ value, besideChunkName }: ScoreProps) => {
  if (!value || Number.isNaN(value)) return null
  return (
    <span
      className={cn(
        'relative block items-center overflow-hidden border border-components-progress-bar-border px-1.25',
        besideChunkName ? 'h-[20.5px] border-l-0' : 'h-5 rounded-md',
      )}
    >
      <span
        className={cn(
          'absolute top-0 left-0 h-full border-r-[1.5px] border-components-progress-brand-progress bg-util-colors-blue-brand-blue-brand-100',
          value === 1 && 'border-r-0',
        )}
        style={{ width: `${value * 100}%` }}
      />
      <span
        className={cn(
          'relative flex h-full items-center space-x-0.5 text-util-colors-blue-brand-blue-brand-700',
        )}
      >
        <span className="system-2xs-medium-uppercase">score</span>
        <span className="system-xs-semibold">{value?.toFixed(2)}</span>
      </span>
    </span>
  )
})
