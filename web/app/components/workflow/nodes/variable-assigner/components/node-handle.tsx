import { memo } from 'react'
import cn from 'classnames'
import {
  Handle,
  Position,
} from 'reactflow'
import AddVariable from './add-variable'
import type { AddVariableProps } from './add-variable'

type NodeHandleProps = {
  handleId?: string
} & AddVariableProps
const NodeHandle = ({
  variableAssignerNodeId,
  handleId = 'target',
  availableVars,
}: NodeHandleProps) => {
  return (
    <Handle
      id={handleId}
      type='target'
      position={Position.Left}
      className={cn(
        '!-left-[13px] !top-1 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none z-[1] !transform-none',
        'after:absolute after:w-0.5 after:h-2 after:left-[5px] after:top-1 after:bg-primary-500',
      )}
    >
      <AddVariable
        variableAssignerNodeId={variableAssignerNodeId}
        handleId={handleId}
        availableVars={availableVars}
      />
    </Handle>
  )
}

export default memo(NodeHandle)
