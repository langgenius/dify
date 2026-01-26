import { cn } from '@/utils/classnames'

type NodeStatusIconProps = {
  status: string
  className?: string
}
const NodeStatusIcon = ({
  status,
  className,
}: NodeStatusIconProps) => {
  return (
    <>
      {
        status === 'succeeded' && (
          <span className={`i-ri-checkbox-circle-fill ${cn('h-4 w-4 shrink-0 text-text-success', className)}`} />
        )
      }
      {
        status === 'failed' && (
          <span className={`i-ri-error-warning-line ${cn('h-4 w-4 shrink-0 text-text-warning', className)}`} />
        )
      }
      {
        (status === 'stopped' || status === 'exception') && (
          <span className={`i-ri-alert-fill ${cn('h-4 w-4 shrink-0 text-text-warning-secondary', className)}`} />
        )
      }
      {
        status === 'running' && (
          <span className={`i-ri-loader-2-line ${cn('h-4 w-4 shrink-0 animate-spin text-text-accent', className)}`} />
        )
      }
    </>
  )
}

export default NodeStatusIcon
