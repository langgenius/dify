import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import {
  Handle,
  Position,
} from 'reactflow'
import { useWorkflowContext } from '../context'
import {
  NodeMap,
  PanelMap,
} from './constants'

const CustomNode = ({
  data,
}: NodeProps) => {
  const NodeComponent = NodeMap[data.type]

  return (
    <>
      <Handle
        type='target'
        position={Position.Top}
        className='!-top-0.5 !w-2 !h-0.5 !bg-primary-500 !rounded-none !border-none !min-h-[2px]'
      />
      <NodeComponent />
      <Handle
        type='source'
        position={Position.Bottom}
        className='!-bottom-0.5 !w-2 !h-0.5 !bg-primary-500 !rounded-none !border-none !min-h-[2px]'
      />
    </>
  )
}

export const Panel = () => {
  const { selectedNode } = useWorkflowContext()
  const PanelComponent = PanelMap[selectedNode?.data.type || '']

  if (!PanelComponent)
    return null

  return (
    <PanelComponent />
  )
}

export default memo(CustomNode)
