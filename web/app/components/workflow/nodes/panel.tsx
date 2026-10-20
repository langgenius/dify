import type { Node } from '../types'
import { memo } from 'react'
import { CUSTOM_NODE } from '../constants'
import BasePanel from './_base/components/workflow-panel'
import { PanelComponentMap } from './panel-components'

type PanelProps = {
  type: Node['type']
  id: Node['id']
  data: Node['data']
}
const Panel = memo((props: PanelProps) => {
  const nodeClass = props.type
  const nodeData = props.data
  if (nodeClass !== CUSTOM_NODE) return null

  const PanelComponent = PanelComponentMap[nodeData.type]!

  return (
    <BasePanel key={`${props.id}-${nodeData.type}`} id={props.id} data={props.data}>
      <PanelComponent />
    </BasePanel>
  )
})

Panel.displayName = 'Panel'

export default Panel
