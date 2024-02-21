import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import {
  Handle,
  Position,
} from 'reactflow'
import { useWorkflowContext } from '../context'
import { BlockEnum } from '../types'
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
        position={Position.Left}
        className={`
          !top-4 !left-0 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0 z-[1]
          after:absolute after:w-0.5 after:h-2 after:-left-0.5 after:top-1 after:bg-primary-500
          ${data.type === BlockEnum.Start && 'opacity-0'}
        `}
        isConnectable={data.type !== BlockEnum.Start}
      />
      <BaseNode
        id={id}
        data={data}
      >
        <NodeComponent />
      </BaseNode>
      <Handle
        type='source'
        position={Position.Right}
        className={`
          !top-4 !right-0 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0
          after:absolute after:w-0.5 after:h-2 after:-right-0.5 after:top-1 after:bg-primary-500
        `}
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
