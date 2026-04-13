import type {
  BlockEnum,
  Node,
} from '../../types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useNodesMetaData } from '@/app/components/workflow/hooks'
import {
  generateNewNode,
  getNodeCustomTypeByNodeDataType,
} from '../../utils'
import {
  buildLoopChildCopy,
  getContainerBounds,
  getContainerResize,
  getLoopChildren,
  getRestrictedLoopPosition,
} from './use-interactions.helpers'

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
    const resize = getContainerResize(currentNode, getContainerBounds(childrenNodes))

    if (resize.width || resize.height) {
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((n) => {
          if (n.id === nodeId) {
            if (resize.width) {
              n.data.width = resize.width
              n.width = resize.width
            }
            if (resize.height) {
              n.data.height = resize.height
              n.height = resize.height
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

    return {
      restrictPosition: getRestrictedLoopPosition(node, nodes.find(n => n.id === node.parentId)),
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

  const handleNodeLoopChildrenCopy = useCallback((nodeId: string, newNodeId: string, idMapping: Record<string, string>) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const childrenNodes = getLoopChildren(nodes, nodeId)
    const newIdMapping = { ...idMapping }

    const copyChildren = childrenNodes.map((child, index) => {
      const childNodeType = child.data.type as BlockEnum
      const { defaultValue } = nodesMetaDataMap![childNodeType]
      const nodesWithSameType = nodes.filter(node => node.data.type === childNodeType)
      const childCopy = buildLoopChildCopy({
        child,
        childNodeType,
        defaultValue: defaultValue as Node['data'],
        nodesWithSameTypeCount: nodesWithSameType.length,
        newNodeId,
        index,
      })
      const { newNode } = generateNewNode({
        ...childCopy.params,
        type: getNodeCustomTypeByNodeDataType(childNodeType),
      })
      newNode.id = `${newNodeId}${newNode.id + childCopy.newId}`
      newIdMapping[child.id] = newNode.id
      return newNode
    })

    return {
      copyChildren,
      newIdMapping,
    }
  }, [store, nodesMetaDataMap])

  return {
    handleNodeLoopRerender,
    handleNodeLoopChildDrag,
    handleNodeLoopChildSizeChange,
    handleNodeLoopChildrenCopy,
  }
}
