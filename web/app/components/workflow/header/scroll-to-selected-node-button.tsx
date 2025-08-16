import type { FC } from 'react'
import { useCallback } from 'react'
import { useNodes, useReactFlow, useStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import type { CommonNodeType } from '../types'
import { useNodesSyncDraft } from '../../workflow-app/hooks'
import cn from '@/utils/classnames'

const ScrollToSelectedNodeButton: FC = () => {
  const reactflow = useReactFlow()
  const nodes = useNodes<CommonNodeType>()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const selectedNode = nodes.find(node => node.data.selected)

  const {
    nodePosition,
    nodeWidth,
    nodeHeight,
  } = useStore(useShallow((s) => {
    if (!selectedNode) return { nodePosition: null, nodeWidth: null, nodeHeight: null }

    const nodes = s.getNodes()
    const currentNode = nodes.find(node => node.id === selectedNode.id)!

    return {
      nodePosition: currentNode.position,
      nodeWidth: currentNode.width,
      nodeHeight: currentNode.height,
    }
  }))
  const transform = useStore(s => s.transform)

  const handleScrollToSelectedNode = useCallback(() => {
    if (!selectedNode || !nodePosition || !nodeWidth || !nodeHeight) return

    const workflowContainer = document.getElementById('workflow-container')
    if (!workflowContainer) return

    const zoom = transform[2]
    const { clientWidth, clientHeight } = workflowContainer
    const { setViewport } = reactflow

    setViewport({
      x: (clientWidth - 400 - nodeWidth * zoom) / 2 - nodePosition.x * zoom,
      y: (clientHeight - nodeHeight * zoom) / 2 - nodePosition.y * zoom,
      zoom: transform[2],
    })
    doSyncWorkflowDraft()
  }, [selectedNode, nodePosition, nodeWidth, nodeHeight, transform, reactflow, doSyncWorkflowDraft])

  if (!selectedNode || !nodePosition || !nodeWidth || !nodeHeight)
    return null

  return (
    <div
      className={cn(
        'system-xs-medium flex h-6 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-3 text-text-tertiary shadow-lg backdrop-blur-sm transition-colors duration-200 hover:text-text-accent',
      )}
      onClick={handleScrollToSelectedNode}
    >
      Scroll to selected node
    </div>
  )
}

export default ScrollToSelectedNodeButton
