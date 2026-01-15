import type { FC } from 'react'
import type { MentionConfig } from '@/app/components/workflow/nodes/_base/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import { useStore as useReactFlowStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useIsChatMode, useWorkflowVariables } from '@/app/components/workflow/hooks'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import ConfigPanel from './config-panel'

type SubGraphChildrenProps = {
  agentName: string
  extractorNodeId: string
  mentionConfig: MentionConfig
  onMentionConfigChange: (config: MentionConfig) => void
}

const SubGraphChildren: FC<SubGraphChildrenProps> = ({
  agentName,
  extractorNodeId,
  mentionConfig,
  onMentionConfigChange,
}) => {
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const nodePanelWidth = useStore(s => s.nodePanelWidth)

  const selectedNode = useReactFlowStore(useShallow((s) => {
    return s.getNodes().find(node => node.data.selected)
  }))

  const extractorNode = useReactFlowStore(useShallow((s) => {
    return s.getNodes().find(node => node.data.type === BlockEnum.LLM)
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
            agentName={agentName}
            extractorNodeId={extractorNodeId}
            mentionConfig={mentionConfig}
            availableNodes={availableNodes}
            availableVars={availableVars}
            onMentionConfigChange={onMentionConfigChange}
          />
        </div>
      </div>
    )
  }, [agentName, availableNodes, availableVars, extractorNodeId, mentionConfig, nodePanelWidth, onMentionConfigChange, selectedNode])

  return (
    <Panel
      topOffset={0}
      components={{
        right: panelRight,
      }}
    />
  )
}

export default memo(SubGraphChildren)
