import { useCallback } from 'react'
import { produce } from 'immer'
import { useStoreApi } from 'reactflow'
import type {
  BlockEnum,
  Node,
} from '../../types'
import {
  generateNewNode,
  getNodeCustomTypeByNodeDataType,
} from '../../utils'
import {
  LOOP_PADDING,
} from '../../constants'
import { CUSTOM_LOOP_START_NODE } from '../loop-start/constants'
import { useNodesMetaData } from '@/app/components/workflow/hooks'

export const useNodeLoopInteractions = () => {
  const store = useStoreApi()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

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

  const handleNodeLoopChildDrag = useCallback((node: Node) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    const restrictPosition: { x?: number; y?: number } = { x: undefined, y: undefined }

    if (node.data.isInLoop) {
      const parentNode = nodes.find(n => n.id === node.parentId)

      if (parentNode) {
        if (node.position.y < LOOP_PADDING.top)
          restrictPosition.y = LOOP_PADDING.top
        if (node.position.x < LOOP_PADDING.left)
          restrictPosition.x = LOOP_PADDING.left
        if (node.position.x + node.width! > parentNode!.width! - LOOP_PADDING.right)
          restrictPosition.x = parentNode!.width! - LOOP_PADDING.right - node.width!
        if (node.position.y + node.height! > parentNode!.height! - LOOP_PADDING.bottom)
          restrictPosition.y = parentNode!.height! - LOOP_PADDING.bottom - node.height!
      }
    }

    return {
      restrictPosition,
    }
  }, [store])

  const handleNodeLoopChildSizeChange = useCallback((nodeId: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const parentId = currentNode.parentId

    if (parentId)
      handleNodeLoopRerender(parentId)
  }, [store, handleNodeLoopRerender])

  const handleNodeLoopChildrenCopy = useCallback((nodeId: string, newNodeId: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const childrenNodes = nodes.filter(n => n.parentId === nodeId && n.type !== CUSTOM_LOOP_START_NODE)

    return childrenNodes.map((child, index) => {
      const childNodeType = child.data.type as BlockEnum
      const {
        defaultValue,
      } = nodesMetaDataMap![childNodeType]
      const nodesWithSameType = nodes.filter(node => node.data.type === childNodeType)
      const { newNode } = generateNewNode({
        type: getNodeCustomTypeByNodeDataType(childNodeType),
        data: {
          ...defaultValue,
          ...child.data,
          selected: false,
          _isBundled: false,
          _connectedSourceHandleIds: [],
          _connectedTargetHandleIds: [],
          title: nodesWithSameType.length > 0 ? `${defaultValue.title} ${nodesWithSameType.length + 1}` : defaultValue.title,
          loop_id: newNodeId,

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
  }, [store, nodesMetaDataMap])

  return {
    handleNodeLoopRerender,
    handleNodeLoopChildDrag,
    handleNodeLoopChildSizeChange,
    handleNodeLoopChildrenCopy,
  }
}
