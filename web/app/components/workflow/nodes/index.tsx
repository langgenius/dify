import { memo } from 'react'
import {
  Handle,
  Position,
  useNodeId,
} from 'reactflow'
import { useWorkflowContext } from '../context'
import {
  NodeMap,
  PanelMap,
} from './constants'

const CustomNode = () => {
  const nodeId = useNodeId()
  const { nodes } = useWorkflowContext()
  const currentNode = nodes.find(node => node.id === nodeId)
  const NodeComponent = NodeMap[currentNode!.data.type as string]

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
