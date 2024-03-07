import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import type { Node } from '../types'
import { canRunBySingle } from '../utils'
import {
  NodeComponentMap,
  PanelComponentMap,
} from './constants'
import BaseNode from './_base/node'
import BasePanel from './_base/panel'
import NodeControl from './_base/components/node-control'

const CustomNode = memo((props: NodeProps) => {
  const nodeId = props.id
  const nodeData = props.data
  const NodeComponent = NodeComponentMap[nodeData.type]

  return (
    <>
      <BaseNode { ...props }>
        <NodeComponent />
      </BaseNode>
      {
        nodeData._selected
        && canRunBySingle(nodeData.type)
        && (
          <NodeControl
            nodeId={nodeId}
            isRunning={nodeData._isSingleRun}
          />
        )
      }
    </>
  )
})
CustomNode.displayName = 'CustomNode'

export const Panel = memo((props: Node) => {
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
