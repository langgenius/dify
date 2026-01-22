import type { FC } from 'react'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import { useStore as useReactFlowStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useIsChatMode, useWorkflowVariables } from '@/app/components/workflow/hooks'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import ConfigPanel from './config-panel'

type SubGraphChildrenProps
  = | {
    variant: 'agent'
    title: string
    extractorNodeId: string
    nestedNodeConfig: NestedNodeConfig
    onNestedNodeConfigChange: (config: NestedNodeConfig) => void
  }
  | {
    variant: 'assemble'
    title: string
    extractorNodeId: string
    nestedNodeConfig: NestedNodeConfig
    onNestedNodeConfigChange: (config: NestedNodeConfig) => void
  }

const SubGraphChildren: FC<SubGraphChildrenProps> = (props) => {
  const {
    title,
    extractorNodeId,
  } = props
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const nodePanelWidth = useStore(s => s.nodePanelWidth)

  const selectedNode = useReactFlowStore(useShallow((s) => {
    return s.getNodes().find(node => node.data.selected)
  }))

  const extractorNode = useReactFlowStore(useShallow((s) => {
    return s.getNodes().find(node => node.id === extractorNodeId)
  }))

  const availableNodes = useMemo(() => {
    return extractorNode ? [extractorNode] : []
  }, [extractorNode])

  const availableVars = useMemo<NodeOutPutVar[]>(() => {
    if (!extractorNode)
      return []

    const vars = getNodeAvailableVars({
      beforeNodes: [extractorNode],
      isChatMode,
      filterVar: () => true,
    })
    return vars.filter(item => item.nodeId === extractorNode.id)
  }, [extractorNode, getNodeAvailableVars, isChatMode])

  const panelRight = useMemo(() => {
    if (selectedNode)
      return null

    return (
      <div className="relative mr-1 h-full">
        <div
          className="flex h-full flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg"
          style={{ width: `${nodePanelWidth}px` }}
        >
          <ConfigPanel
            agentName={title}
            extractorNodeId={extractorNodeId}
            nestedNodeConfig={props.nestedNodeConfig}
            availableNodes={availableNodes}
            availableVars={availableVars}
            onNestedNodeConfigChange={props.onNestedNodeConfigChange}
          />
        </div>
      </div>
    )
  }, [availableNodes, availableVars, extractorNodeId, nodePanelWidth, props.nestedNodeConfig, props.onNestedNodeConfigChange, selectedNode, title])

  return (
    <Panel
      withHeader={false}
      components={{
        right: panelRight,
      }}
    />
  )
}

export default memo(SubGraphChildren)
