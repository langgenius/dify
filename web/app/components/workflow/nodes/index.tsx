import type { NodeProps } from 'reactflow'
import { memo, useMemo } from 'react'
import BaseNode from './_base/node'
import { NodeComponentMap } from './components'

const NullComponent = () => null

const CustomNode = (props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = NodeComponentMap[nodeData.type] ?? NullComponent

  return (
    <>
      <BaseNode id={props.id} data={props.data}>
        {createElement(NodeComponent)}
      </BaseNode>
    </>
  )
}
CustomNode.displayName = 'CustomNode'

export default memo(CustomNode)
