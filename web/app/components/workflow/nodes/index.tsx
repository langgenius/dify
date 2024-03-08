import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import type { Node } from '../types'
import {
  NodeComponentMap,
  PanelComponentMap,
} from './constants'
import BaseNode from './_base/node'
import BasePanel from './_base/panel'

const CustomNode = memo((props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = NodeComponentMap[nodeData.type]

  return (
    <BaseNode { ...props }>
      <NodeComponent />
    </BaseNode>
  )
})
CustomNode.displayName = 'CustomNode'

export const Panel = memo((props: Node) => {
  const nodeData = props.data
  const PanelComponent = PanelComponentMap[nodeData.type]

  return (
    <BasePanel key={props.id} {...props}>
      <PanelComponent />
    </BasePanel>
  )
})

Panel.displayName = 'Panel'

export default memo(CustomNode)
