import type { FC } from 'react'
import type { MentionConfig } from '@/app/components/workflow/nodes/_base/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import { useStore as useReactFlowStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useIsChatMode, useWorkflowVariables } from '@/app/components/workflow/hooks'
import { Panel as NodePanel } from '@/app/components/workflow/nodes'
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

  const { selectedNode, nodes } = useReactFlowStore(useShallow((s) => {
    const nodes = s.getNodes()
    const currentNode = nodes.find(node => node.data.selected)

    if (currentNode?.data.type === BlockEnum.LLM) {
      return {
        selectedNode: {
          id: currentNode.id,
          type: currentNode.type,
          data: currentNode.data,
        },
        nodes,
      }
    }
    return {
      selectedNode: null,
      nodes,
    }
  }))

  const extractorNode = useMemo(() => {
    return nodes.find(node => node.data.type === BlockEnum.LLM)
  }, [nodes])

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

  const nodePanel = useMemo(() => {
    if (!selectedNode)
      return null

    return (
      <NodePanel
        id={selectedNode.id}
        type={selectedNode.type}
        data={selectedNode.data}
      />
    )
  }, [selectedNode])

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex">
      <div className="pointer-events-auto">
        {nodePanel || (
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
        )}
      </div>
    </div>
  )
}

export default memo(SubGraphChildren)
