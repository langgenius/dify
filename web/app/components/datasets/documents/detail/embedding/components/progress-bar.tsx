import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type ProgressBarProps = {
  percent: number
  isEmbedding: boolean
  isCompleted: boolean
  isPaused: boolean
  isError: boolean
}

const ProgressBar: FC<ProgressBarProps> = React.memo(({
  percent,
  isEmbedding,
  isCompleted,
  isPaused,
  isError,
}) => {
  const isActive = isEmbedding || isCompleted
  const isHighlighted = isPaused || isError

  return (
    <div
      className={cn(
        'flex h-2 w-full items-center overflow-hidden rounded-md border border-components-progress-bar-border',
        isEmbedding ? 'bg-components-progress-bar-bg/50' : 'bg-components-progress-bar-bg',
      )}
    >
      <div
        className={cn(
          'h-full transition-all duration-300',
          isActive && 'bg-components-progress-bar-progress-solid',
          isHighlighted && 'bg-components-progress-bar-progress-highlight',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
})

ProgressBar.displayName = 'ProgressBar'

export default ProgressBar
