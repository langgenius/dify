import type { NodeProps } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import {
  memo,
  useMemo,
} from 'react'
import { CUSTOM_NODE } from '@/app/components/workflow/constants'
import BasePanel from '@/app/components/workflow/nodes/_base/components/workflow-panel/index'
import BaseNode from '@/app/components/workflow/nodes/_base/node'
import {
  NodeComponentMap,
  PanelComponentMap,
} from '@/app/components/workflow/nodes/components'

const CustomNode = (props: NodeProps) => {
  const nodeData = props.data
  const NodeComponent = useMemo(() => NodeComponentMap[nodeData.type], [nodeData.type])!

  return (
    <>
      <BaseNode
        id={props.id}
        data={props.data}
      >
        <NodeComponent />
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
  const PanelComponent = useMemo(() => {
    if (nodeClass === CUSTOM_NODE)
      return PanelComponentMap[nodeData.type]
    return () => null
  }, [nodeClass, nodeData.type])!

  if (nodeClass === CUSTOM_NODE) {
    return (
      <BasePanel
        key={props.id}
        id={props.id}
        data={props.data}
      >
        <PanelComponent />
      </BasePanel>
    )
  }

  return null
})

Panel.displayName = 'Panel'

export default memo(CustomNode)
