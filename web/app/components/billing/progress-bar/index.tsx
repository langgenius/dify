import { cn } from '@langgenius/dify-ui/cn'

type ProgressBarProps = {
  percent: number
  color: string
  indeterminate?: boolean
  indeterminateFull?: boolean // For Sandbox users: full width stripe
}

const ProgressBar = ({
  percent = 0,
  color = 'bg-components-progress-bar-progress-solid',
  indeterminate = false,
  indeterminateFull = false,
}: ProgressBarProps) => {
  if (indeterminate) {
    return (
      <div className="overflow-hidden rounded-md bg-components-progress-bar-bg">
        <div
          data-testid="billing-progress-bar-indeterminate"
          className={cn('h-1 rounded-md bg-progress-bar-indeterminate-stripe', indeterminateFull ? 'w-full' : 'w-[30px]')}
        />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md bg-components-progress-bar-bg">
      <div
        data-testid="billing-progress-bar"
        className={cn('h-1 rounded-md', color)}
        style={{
          width: `${Math.min(percent, 100)}%`,
        }}
      />
    </div>
  )
}

export default ProgressBar
