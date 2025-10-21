import { useCallback } from 'react'
import { produce } from 'immer'
import { useStoreApi } from 'reactflow'
import type {
  Node,
} from '@/app/components/workflow/types'
import {
  LOOP_PADDING,
} from '@/app/components/workflow/constants'

export const useNodeLoopInteractions = () => {
  const store = useStoreApi()

  const handleNodeLoopRerender = useCallback((nodeId: string) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const childrenNodes = nodes.filter(n => n.parentId === nodeId)
    let rightNode: Node
    let bottomNode: Node

    childrenNodes.forEach((n) => {
      if (rightNode) {
        if (n.position.x + n.width! > rightNode.position.x + rightNode.width!)
          rightNode = n
      }
      else {
        rightNode = n
      }
      if (bottomNode) {
        if (n.position.y + n.height! > bottomNode.position.y + bottomNode.height!)
          bottomNode = n
      }
      else {
        bottomNode = n
      }
    })

    const widthShouldExtend = rightNode! && currentNode.width! < rightNode.position.x + rightNode.width!
    const heightShouldExtend = bottomNode! && currentNode.height! < bottomNode.position.y + bottomNode.height!

    if (widthShouldExtend || heightShouldExtend) {
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((n) => {
          if (n.id === nodeId) {
            if (widthShouldExtend) {
              n.data.width = rightNode.position.x + rightNode.width! + LOOP_PADDING.right
              n.width = rightNode.position.x + rightNode.width! + LOOP_PADDING.right
            }
            if (heightShouldExtend) {
              n.data.height = bottomNode.position.y + bottomNode.height! + LOOP_PADDING.bottom
              n.height = bottomNode.position.y + bottomNode.height! + LOOP_PADDING.bottom
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
