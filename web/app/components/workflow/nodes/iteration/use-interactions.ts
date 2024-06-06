import { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import type {
  BlockEnum,
  Node,
} from '../../types'
import { generateNewNode } from '../../utils'
import {
  ITERATION_PADDING,
  NODES_INITIAL_DATA,
} from '../../constants'

export const useNodeIterationInteractions = () => {
  const { t } = useTranslation()
  const store = useStoreApi()

  const handleNodeIterationRerender = useCallback((nodeId: string) => {
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
              n.data.width = rightNode.position.x + rightNode.width! + ITERATION_PADDING.right
              n.width = rightNode.position.x + rightNode.width! + ITERATION_PADDING.right
            }
            if (heightShouldExtend) {
              n.data.height = bottomNode.position.y + bottomNode.height! + ITERATION_PADDING.bottom
              n.height = bottomNode.position.y + bottomNode.height! + ITERATION_PADDING.bottom
            }
          }
        })
      })

      setNodes(newNodes)
    }
  }, [store])

  const handleNodeIterationChildDrag = useCallback((node: Node) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    const restrictPosition: { x?: number; y?: number } = { x: undefined, y: undefined }

    if (node.data.isInIteration) {
      const parentNode = nodes.find(n => n.id === node.parentId)

      if (parentNode) {
        if (node.position.y < ITERATION_PADDING.top)
          restrictPosition.y = ITERATION_PADDING.top
        if (node.position.x < ITERATION_PADDING.left)
          restrictPosition.x = ITERATION_PADDING.left
        if (node.position.x + node.width! > parentNode!.width! - ITERATION_PADDING.right)
          restrictPosition.x = parentNode!.width! - ITERATION_PADDING.right - node.width!
        if (node.position.y + node.height! > parentNode!.height! - ITERATION_PADDING.bottom)
          restrictPosition.y = parentNode!.height! - ITERATION_PADDING.bottom - node.height!
      }
    }

    return {
      restrictPosition,
    }
  }, [store])

  const handleNodeIterationChildSizeChange = useCallback((nodeId: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const parentId = currentNode.parentId

    if (parentId)
      handleNodeIterationRerender(parentId)
  }, [store, handleNodeIterationRerender])

  const handleNodeIterationChildrenCopy = useCallback((nodeId: string, newNodeId: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const childrenNodes = nodes.filter(n => n.parentId === nodeId)

    return childrenNodes.map((child, index) => {
      const childNodeType = child.data.type as BlockEnum
      const nodesWithSameType = nodes.filter(node => node.data.type === childNodeType)
      const newNode = generateNewNode({
        data: {
          ...NODES_INITIAL_DATA[childNodeType],
          ...child.data,
          selected: false,
          _isBundled: false,
          _connectedSourceHandleIds: [],
          _connectedTargetHandleIds: [],
          title: nodesWithSameType.length > 0 ? `${t(`workflow.blocks.${childNodeType}`)} ${nodesWithSameType.length + 1}` : t(`workflow.blocks.${childNodeType}`),
        },
        position: child.position,
        positionAbsolute: child.positionAbsolute,
        parentId: newNodeId,
        extent: child.extent,
        zIndex: child.zIndex,
      })
      newNode.id = `${newNodeId}${newNode.id + index}`
      return newNode
    })
  }, [store, t])

  return {
    handleNodeIterationRerender,
    handleNodeIterationChildDrag,
    handleNodeIterationChildSizeChange,
    handleNodeIterationChildrenCopy,
  }
}
