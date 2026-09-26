import type { NodeProps } from 'reactflow'
import { memo, useMemo } from 'react'
import BaseNode from './_base/node'
import { NodeComponentMap } from './components'

const CustomNode = (props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = useMemo(() => NodeComponentMap[nodeData.type], [nodeData.type])!

  return (
    <>
      <BaseNode id={props.id} data={props.data}>
        <NodeComponent />
      </BaseNode>
    </>
  )
}
CustomNode.displayName = 'CustomNode'

export default memo(CustomNode)
