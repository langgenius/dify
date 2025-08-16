import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useNodes, useReactFlow, useStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import type { CommonNodeType } from '../types'
import { useNodesSyncDraft } from '../../workflow-app/hooks'
import cn from '@/utils/classnames'

const ScrollToSelectedNodeButton: FC = () => {
  const reactflow = useReactFlow()
  const nodes = useNodes<CommonNodeType>()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const [isVisible, setIsVisible] = useState(false)

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

  const shouldShow = selectedNode && nodePosition && nodeWidth && nodeHeight

  useEffect(() => {
    if (shouldShow)
      setIsVisible(true)
     else
      setIsVisible(false)
  }, [shouldShow])

  if (!shouldShow && !isVisible)
    return null

  return (
    <div
      className={cn(
        'system-xs-medium flex h-6 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-3 text-text-tertiary shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out',
        isVisible && shouldShow ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-2 scale-95 opacity-0',
      )}
      onClick={handleScrollToSelectedNode}
    >
      <span className='transition-colors duration-200 ease-in-out hover:text-text-accent'>Scroll to selected node</span>
    </div>
  )
}

export default ScrollToSelectedNodeButton
