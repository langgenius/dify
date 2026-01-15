import type { FC } from 'react'
import type { MentionConfig } from '@/app/components/workflow/nodes/_base/types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { memo, useEffect, useMemo, useRef } from 'react'
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
  const setRightPanelWidth = useStore(s => s.setRightPanelWidth)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = panelRef.current
    if (!element)
      return

    const updateWidth = (width: number) => {
      if (width > 0)
        setRightPanelWidth(width)
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.borderBoxSize?.length)
          updateWidth(entry.borderBoxSize[0].inlineSize)
        else if (entry.contentRect.width > 0)
          updateWidth(entry.contentRect.width)
        else
          updateWidth(element.getBoundingClientRect().width)
      }
    })

    resizeObserver.observe(element)
    updateWidth(element.getBoundingClientRect().width)

    return () => {
      resizeObserver.disconnect()
    }
  }, [setRightPanelWidth])

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
      <div className="pointer-events-auto" ref={panelRef}>
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
