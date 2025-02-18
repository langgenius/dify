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
          <RiCheckboxCircleFill className={cn('text-text-success h-4 w-4 shrink-0', className)} />
        )
      }
      {
        status === 'failed' && (
          <RiErrorWarningLine className={cn('text-text-warning h-4 w-4 shrink-0', className)} />
        )
      }
      {
        (status === 'stopped' || status === 'exception') && (
          <RiAlertFill className={cn('text-text-warning-secondary h-4 w-4 shrink-0', className)} />
        )
      }
      {
        status === 'running' && (
          <RiLoader2Line className={cn('text-text-accent h-4 w-4 shrink-0 animate-spin', className)} />
        )
      }
    </>
  )
}

export default NodeStatusIcon
