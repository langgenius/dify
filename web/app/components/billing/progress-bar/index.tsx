'use client'
import type { MeterTone } from '@langgenius/dify-ui/meter'
import { cn } from '@langgenius/dify-ui/cn'
import { MeterIndicator, MeterRoot, MeterTrack } from '@langgenius/dify-ui/meter'

type ProgressBarProps = {
  percent?: number
  tone?: MeterTone
  indeterminate?: boolean
  /** For Sandbox users: render a full-width striped placeholder instead of a 30px pill. */
  indeterminateFull?: boolean
}

function ProgressBar({
  percent = 0,
  tone = 'neutral',
  indeterminate = false,
  indeterminateFull = false,
}: ProgressBarProps) {
  if (indeterminate) {
    return (
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-md bg-components-progress-bar-bg"
      >
        <div
          data-testid="billing-progress-bar-indeterminate"
          className={cn(
            'h-1 rounded-md bg-progress-bar-indeterminate-stripe',
            indeterminateFull ? 'w-full' : 'w-[30px]',
          )}
        />
      </div>
    )
  }

  return (
    <MeterRoot value={Math.min(percent, 100)} max={100}>
      <MeterTrack>
        <MeterIndicator data-testid="billing-progress-bar" tone={tone} />
      </MeterTrack>
    </MeterRoot>
  )
}

export default ProgressBar
