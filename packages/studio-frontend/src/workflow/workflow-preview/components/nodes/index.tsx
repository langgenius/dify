import type { NodeProps } from 'reactflow'
import BaseNode from '@/app/components/workflow/workflow-preview/components/nodes/base'
import { NodeComponentMap } from '@/app/components/workflow/workflow-preview/components/nodes/constants'

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
