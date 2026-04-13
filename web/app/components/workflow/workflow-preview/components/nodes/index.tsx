import type { NodeProps } from 'reactflow'
import BaseNode from './base'
import { NodeComponentMap } from './constants'

const CustomNode = (props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = NodeComponentMap[nodeData.type]

  return (
    <>
      <BaseNode {...props}>
        { NodeComponent && <NodeComponent /> }
      </BaseNode>
    </>
  )
}

export default CustomNode
