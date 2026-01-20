import { cn } from '@/utils/classnames'

type ProgressBarProps = {
  percent: number
  color: string
  indeterminate?: boolean
  indeterminateFull?: boolean // For Sandbox users: full width stripe
}

const ProgressBar = ({
  percent = 0,
  color = '#2970FF',
  indeterminate = false,
  indeterminateFull = false,
}: ProgressBarProps) => {
  if (indeterminate) {
    return (
      <div className="overflow-hidden rounded-[6px] bg-components-progress-bar-bg">
        <div
          data-testid="billing-progress-bar-indeterminate"
          className={cn('h-1 rounded-[6px]', indeterminateFull ? 'w-full' : 'w-[30px]')}
          style={{
            background: 'repeating-linear-gradient(-55deg, #D0D5DD, #D0D5DD 2px, transparent 2px, transparent 5px)',
          }}
        />
      </div>
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
