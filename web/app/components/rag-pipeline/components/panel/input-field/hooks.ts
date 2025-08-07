import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { useStore as useReactflow } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'

export const useFloatingRight = (targetElementWidth: number) => {
  const [floatingRight, setFloatingRight] = useState(false)
  const nodePanelWidth = useStore(state => state.nodePanelWidth)
  const workflowCanvasWidth = useStore(state => state.workflowCanvasWidth)
  const otherPanelWidth = useStore(state => state.otherPanelWidth)

  const selectedNodeId = useReactflow(useShallow((s) => {
    const nodes = s.getNodes()
    const currentNode = nodes.find(node => node.data.selected)

    if (currentNode)
      return currentNode.id
  }))

  useEffect(() => {
    if (typeof workflowCanvasWidth === 'number') {
      const inputFieldPanelWidth = 400
      const marginRight = 4
      const leftWidth = workflowCanvasWidth - (selectedNodeId ? nodePanelWidth : 0) - otherPanelWidth - inputFieldPanelWidth - marginRight
      setFloatingRight(leftWidth < targetElementWidth + marginRight)
    }
  }, [workflowCanvasWidth, nodePanelWidth, otherPanelWidth, selectedNodeId, targetElementWidth])

  const floatingRightWidth = useMemo(() => {
    if (!floatingRight) return targetElementWidth
    const width = Math.min(targetElementWidth, (selectedNodeId ? nodePanelWidth : 0) + otherPanelWidth)
    return width
  }, [floatingRight, selectedNodeId, nodePanelWidth, otherPanelWidth, targetElementWidth])

  return {
    floatingRight,
    floatingRightWidth,
  }
}
