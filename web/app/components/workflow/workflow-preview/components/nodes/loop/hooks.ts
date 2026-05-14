import type {
  Node,
} from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  LOOP_PADDING,
} from '@/app/components/workflow/constants'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import {
  getNodeHeight,
  getNodeWidth,
} from '@/app/components/workflow/utils'

export const useNodeLoopInteractions = () => {
  const store = useWorkflowStoreApi()

  const handleNodeLoopRerender = useCallback((nodeId: string) => {
    const {
      nodes,
      setNodes,
    } = store.getState()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const childrenNodes = nodes.filter(n => n.parentId === nodeId)
    let rightNode: Node
    let bottomNode: Node

    childrenNodes.forEach((n) => {
      if (rightNode) {
        if (n.position.x + getNodeWidth(n) > rightNode.position.x + getNodeWidth(rightNode))
          rightNode = n
      }
      else {
        rightNode = n
      }
      if (bottomNode) {
        if (n.position.y + getNodeHeight(n) > bottomNode.position.y + getNodeHeight(bottomNode))
          bottomNode = n
      }
      else {
        bottomNode = n
      }
    })

    const widthShouldExtend = rightNode! && getNodeWidth(currentNode) < rightNode.position.x + getNodeWidth(rightNode)
    const heightShouldExtend = bottomNode! && getNodeHeight(currentNode) < bottomNode.position.y + getNodeHeight(bottomNode)

    if (widthShouldExtend || heightShouldExtend) {
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((n) => {
          if (n.id === nodeId) {
            if (widthShouldExtend) {
              n.data.width = rightNode.position.x + getNodeWidth(rightNode) + LOOP_PADDING.right
              n.width = rightNode.position.x + getNodeWidth(rightNode) + LOOP_PADDING.right
            }
            if (heightShouldExtend) {
              n.data.height = bottomNode.position.y + getNodeHeight(bottomNode) + LOOP_PADDING.bottom
              n.height = bottomNode.position.y + getNodeHeight(bottomNode) + LOOP_PADDING.bottom
            }
          }
        })
      })

      setNodes(newNodes)
    }
  }, [store])

  return {
    handleNodeLoopRerender,
  }
}
