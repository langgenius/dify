import type { NodeProps } from '@/app/components/workflow/types'
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
