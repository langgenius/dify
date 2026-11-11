import type { Node } from '../types'
import { memo } from 'react'
import { ExternalAgentWorkflowPreviewPanel } from '@/features/agent-v2/external-agent/workflow-preview/panel'
import { isExternalAgentWorkflowPreviewData } from '@/features/agent-v2/external-agent/workflow-preview/types'
import { CUSTOM_NODE } from '../constants'
import { getNodeCatalogType } from '../utils/node'
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

  if (isExternalAgentWorkflowPreviewData(nodeData))
    return <ExternalAgentWorkflowPreviewPanel id={props.id} data={nodeData} />

  const PanelComponent = PanelComponentMap[nodeData.type]!

  return (
    <BasePanel key={`${props.id}-${getNodeCatalogType(nodeData)}`} id={props.id} data={props.data}>
      <PanelComponent />
    </BasePanel>
  )
})

Panel.displayName = 'Panel'

export default Panel
