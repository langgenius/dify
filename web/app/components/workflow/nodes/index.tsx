import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import { BlockEnum, type SelectedNode } from '../types'
import {
  NodeComponentMap,
  PanelComponentMap,
} from './constants'
import BaseNode from './_base/node'
import BasePanel from './_base/panel'
import {
  NodeSourceHandle,
  NodeTargetHandle,
} from './_base/components/node-handle'

const CustomNode = memo((props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = NodeComponentMap[nodeData.type]

  return (
    <>
      <NodeTargetHandle { ...props } />
      <BaseNode { ...props }>
        <NodeComponent />
      </BaseNode>
      {
        nodeData.type !== BlockEnum.IfElse && (
          <NodeSourceHandle
            { ...props }
            handleClassName='!top-[17px] !right-0'
            nodeSelectorClassName='absolute -right-2 top-4'
            handleId='source'
          />
        )
      }
    </>
  )
})
CustomNode.displayName = 'CustomNode'

export const Panel = memo((props: SelectedNode) => {
  const nodeData = props.data
  const PanelComponent = PanelComponentMap[nodeData.type]

  return (
    <BasePanel {...props}>
      <PanelComponent />
    </BasePanel>
  )
})

Panel.displayName = 'Panel'

export default memo(CustomNode)
