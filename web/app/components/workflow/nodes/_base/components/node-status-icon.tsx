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
          <RiCheckboxCircleFill className={cn('h-4 w-4 shrink-0 text-text-success', className)} />
        )
      }
      {
        status === 'failed' && (
          <RiErrorWarningLine className={cn('h-4 w-4 shrink-0 text-text-warning', className)} />
        )
      }
      {
        (status === 'stopped' || status === 'exception') && (
          <RiAlertFill className={cn('h-4 w-4 shrink-0 text-text-warning-secondary', className)} />
        )
      }
      {
        status === 'running' && (
          <RiLoader2Line className={cn('h-4 w-4 shrink-0 animate-spin text-text-accent', className)} />
        )
      }
    </>
  )
}

export default NodeStatusIcon
