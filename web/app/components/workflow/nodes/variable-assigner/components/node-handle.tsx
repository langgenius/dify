import { memo } from 'react'
import cn from 'classnames'
import {
  Handle,
  Position,
} from 'reactflow'

type NodeHandleProps = {
  connected: boolean
}
const NodeHandle = ({
  connected,
}: NodeHandleProps) => {
  return (
    <Handle
      type='target'
      position={Position.Left}
      className={cn(
        '!-left-2 !top-0 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none z-[1] !transform-none',
        'after:absolute after:w-0.5 after:h-2 after:left-[5px] after:top-1 after:bg-primary-500',
        !connected && 'after:opacity-0',
      )}
    />
  )
}

export default memo(NodeHandle)
