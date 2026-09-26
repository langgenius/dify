import type { NodeProps } from 'reactflow'
import type { Node } from '../types'
import { createElement, memo } from 'react'
import { CUSTOM_NODE } from '../constants'
import BasePanel from './_base/components/workflow-panel'
import BaseNode from './_base/node'
import { NodeComponentMap, PanelComponentMap } from './components'

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

type PanelProps = {
  type: Node['type']
  id: Node['id']
  data: Node['data']
}
export const Panel = memo((props: PanelProps) => {
  const nodeClass = props.type
  const nodeData = props.data
  const PanelComponent =
    (nodeClass === CUSTOM_NODE ? PanelComponentMap[nodeData.type] : NullComponent) ?? NullComponent

  if (nodeClass === CUSTOM_NODE) {
    return (
      <BasePanel key={`${props.id}-${nodeData.type}`} id={props.id} data={props.data}>
        {createElement(PanelComponent)}
      </BasePanel>
    )
  }

  return null
})

Panel.displayName = 'Panel'

export default memo(CustomNode)
