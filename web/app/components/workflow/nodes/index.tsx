import type { NodeProps } from 'reactflow'
import { memo } from 'react'
import ErrorBoundary from '@/app/components/base/error-boundary'
import BaseNode from './_base/node'
import { NodeComponentMap } from './components'

const NodeContent = (props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = NodeComponentMap[nodeData.type]!

  return (
    <BaseNode id={props.id} data={props.data}>
      <NodeComponent />
    </BaseNode>
  )
}

const CustomNode = (props: NodeProps) => {
  const nodeType = typeof props.data?.type === 'string' ? props.data.type : ''

  return (
    <ErrorBoundary resetKeys={[props.id, nodeType]}>
      <NodeContent {...props} />
    </ErrorBoundary>
  )
}
CustomNode.displayName = 'CustomNode'

export default memo(CustomNode)
