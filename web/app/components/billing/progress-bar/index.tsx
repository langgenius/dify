import { cn } from '@/utils/classnames'

type ProgressBarProps = {
  percent: number
  color: string
  indeterminate?: boolean
}

const ProgressBar = ({
  percent = 0,
  color = '#2970FF',
  indeterminate = false,
}: ProgressBarProps) => {
  if (indeterminate) {
    return (
      <div
        data-testid="billing-progress-bar-indeterminate"
        className="h-1 overflow-hidden rounded-[6px] bg-components-progress-bar-bg"
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-[6px] bg-components-progress-bar-bg">
      <div
        data-testid="billing-progress-bar"
        className={cn('h-1 rounded-[6px]', color)}
        style={{
          width: `${Math.min(percent, 100)}%`,
        }}
      />
    </div>
  )
}

export default ProgressBar
