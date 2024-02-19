import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import {
  Handle,
  Position,
} from 'reactflow'
import { useWorkflowContext } from '../context'
import {
  NodeComponentMap,
  PanelComponentMap,
} from './constants'
import BaseNode from './_base/node'
import BasePanel from './_base/panel'

const CustomNode = ({
  id,
  data,
}: NodeProps) => {
  const NodeComponent = NodeComponentMap[data.type]

  return (
    <>
      <Handle
        type='target'
        position={Position.Top}
        className='!-top-0.5 !w-2 !h-0.5 !bg-primary-500 !rounded-none !border-none !min-h-[2px]'
      />
      <BaseNode
        id={id}
        data={data}
      >
        <NodeComponent />
      </BaseNode>
      <Handle
        type='source'
        position={Position.Bottom}
        className='!-bottom-0.5 !w-2 !h-0.5 !bg-primary-500 !rounded-none !border-none !min-h-[2px]'
      />
    </>
  )
}

export const Panel = memo(() => {
  const { selectedNode } = useWorkflowContext()

  if (!selectedNode)
    return null

  const PanelComponent = PanelComponentMap[selectedNode.data.type]

  return (
    <BasePanel
      id={selectedNode.id}
      data={selectedNode.data}
    >
      <PanelComponent />
    </BasePanel>
  )
})

Panel.displayName = 'Panel'

export default memo(CustomNode)
