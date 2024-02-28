import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import type { Node } from '../types'
import { BlockEnum } from '../types'
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
      {
        nodeData.type !== BlockEnum.VariableAssigner && (
          <NodeTargetHandle
            { ...props }
            handleClassName='!top-[17px] !-left-2'
            handleId='target'
          />
        )
      }
      <BaseNode { ...props }>
        <NodeComponent />
      </BaseNode>
      {
        nodeData.type !== BlockEnum.IfElse && nodeData.type !== BlockEnum.QuestionClassifier && (
          <NodeSourceHandle
            { ...props }
            handleClassName='!top-[17px] !-right-2'
            handleId='source'
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
