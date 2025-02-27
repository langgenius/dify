import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader2Line,
} from '@remixicon/react'
import cn from '@/utils/classnames'

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
          <RiCheckboxCircleFill className={cn('shrink-0 w-4 h-4 text-text-success', className)} />
        )
      }
      {
        status === 'failed' && (
          <RiErrorWarningLine className={cn('shrink-0 w-4 h-4 text-text-warning', className)} />
        )
      }
      {
        (status === 'stopped' || status === 'exception') && (
          <RiAlertFill className={cn('shrink-0 w-4 h-4 text-text-warning-secondary', className)} />
        )
      }
      {
        status === 'running' && (
          <RiLoader2Line className={cn('shrink-0 w-4 h-4 text-text-accent animate-spin', className)} />
        )
      }
    </>
  )
}

export default NodeStatusIcon
