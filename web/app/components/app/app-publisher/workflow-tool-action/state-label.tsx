import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'

type WorkflowToolStateLabelProps = {
  label: string
  outdated: boolean
}

const WorkflowToolStateLabel = ({ label, outdated }: WorkflowToolStateLabelProps) => {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center gap-1 system-xs-semibold-uppercase',
        outdated ? 'text-util-colors-warning-warning-600' : 'text-util-colors-green-green-600',
      )}
    >
      <StatusDot size="small" status={outdated ? 'warning' : 'success'} />
      {label}
    </span>
  )
}

export default WorkflowToolStateLabel
