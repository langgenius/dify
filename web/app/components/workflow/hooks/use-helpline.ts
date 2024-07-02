import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import type { Node } from '../types'
import { useWorkflowStore } from '../store'

export const useHelpline = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleSetHelpline = useCallback((node: Node) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const {
      setHelpLineHorizontal,
      setHelpLineVertical,
    } = workflowStore.getState()

    if (node.data.isInIteration) {
      return {
        showHorizontalHelpLineNodes: [],
        showVerticalHelpLineNodes: [],
      }
    }
    const showHorizontalHelpLineNodes = nodes.filter((n) => {
      if (n.id === node.id)
        return false

      if (n.data.isInIteration)
        return false

      const nY = Math.ceil(n.position.y)
      const nodeY = Math.ceil(node.position.y)

      if (nY - nodeY < 5 && nY - nodeY > -5)
        return true

      return false
    }).sort((a, b) => a.position.x - b.position.x)

    const showHorizontalHelpLineNodesLength = showHorizontalHelpLineNodes.length
    if (showHorizontalHelpLineNodesLength > 0) {
      const first = showHorizontalHelpLineNodes[0]
      const last = showHorizontalHelpLineNodes[showHorizontalHelpLineNodesLength - 1]

      const helpLine = {
        top: first.position.y,
        left: first.position.x,
        width: last.position.x + last.width! - first.position.x,
      }

      if (node.position.x < first.position.x) {
        helpLine.left = node.position.x
        helpLine.width = first.position.x + first.width! - node.position.x
      }

      if (node.position.x > last.position.x)
        helpLine.width = node.position.x + node.width! - first.position.x

      setHelpLineHorizontal(helpLine)
    }
    else {
      setHelpLineHorizontal()
    }

    const showVerticalHelpLineNodes = nodes.filter((n) => {
      if (n.id === node.id)
        return false
      if (n.data.isInIteration)
        return false

      const nX = Math.ceil(n.position.x)
      const nodeX = Math.ceil(node.position.x)

      if (nX - nodeX < 5 && nX - nodeX > -5)
        return true

      return false
    }).sort((a, b) => a.position.x - b.position.x)
    const showVerticalHelpLineNodesLength = showVerticalHelpLineNodes.length

    if (showVerticalHelpLineNodesLength > 0) {
      const first = showVerticalHelpLineNodes[0]
      const last = showVerticalHelpLineNodes[showVerticalHelpLineNodesLength - 1]

      const helpLine = {
        top: first.position.y,
        left: first.position.x,
        height: last.position.y + last.height! - first.position.y,
      }

      if (node.position.y < first.position.y) {
        helpLine.top = node.position.y
        helpLine.height = first.position.y + first.height! - node.position.y
      }

      if (node.position.y > last.position.y)
        helpLine.height = node.position.y + node.height! - first.position.y

      setHelpLineVertical(helpLine)
    }
    else {
      setHelpLineVertical()
    }

    return {
      showHorizontalHelpLineNodes,
      showVerticalHelpLineNodes,
    }
  }, [store, workflowStore])

  return {
    handleSetHelpline,
  }
}
