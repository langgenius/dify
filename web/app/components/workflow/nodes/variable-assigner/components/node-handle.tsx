import type { MouseEvent } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import {
  Handle,
  Position,
} from 'reactflow'
import type { VariableAssignerNodeType } from '../types'
import AddVariable from './add-variable'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { useStore } from '@/app/components/workflow/store'

type NodeHandleProps = {
  handleId?: string
  connected?: boolean
  variableAssignerNodeId: string
  availableVars: NodeOutPutVar[]
  variableAssignerNodeData: VariableAssignerNodeType
}
const NodeHandle = ({
  connected,
  variableAssignerNodeId,
  handleId = 'target',
  availableVars,
  variableAssignerNodeData,
}: NodeHandleProps) => {
  const [open, setOpen] = useState(false)
  const connectingNodePayload = useStore(s => s.connectingNodePayload)
  const isUnConnectable = connectingNodePayload?.handleType === 'source'

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])

  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }, [])

  return (
    <Handle
      id={handleId}
      type='target'
      onClick={handleHandleClick}
      position={Position.Left}
      isConnectable={!isUnConnectable}
      className={cn(
        '!-left-[13px] !top-1 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none z-[1] !transform-none',
        'after:absolute after:w-0.5 after:h-2 after:left-[5px] after:top-1 after:bg-primary-500 pointer-events-none',
        !connected && 'after:opacity-0',
      )}
    >
      <AddVariable
        open={open}
        onOpenChange={handleOpenChange}
        variableAssignerNodeId={variableAssignerNodeId}
        variableAssignerNodeData={variableAssignerNodeData}
        handleId={handleId}
        availableVars={availableVars}
      />
    </Handle>
  )
}

export default memo(NodeHandle)
