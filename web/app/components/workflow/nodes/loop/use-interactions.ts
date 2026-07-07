import type {
  BlockEnum,
  Node,
} from '../../types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useNodesMetaData } from '@/app/components/workflow/hooks'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
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
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

  const handleNodeLoopRerender = useCallback((nodeId: string) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()
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
  }, [collaborativeWorkflow])

  const handleNodeLoopChildDrag = useCallback((node: Node) => {
    const { nodes } = collaborativeWorkflow.getState()

    return {
      restrictPosition: getRestrictedLoopPosition(node, nodes.find(n => n.id === node.parentId)),
    }
  }, [collaborativeWorkflow])

  const handleNodeLoopChildSizeChange = useCallback((nodeId: string) => {
    const { nodes } = collaborativeWorkflow.getState()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const parentId = currentNode.parentId

    if (parentId)
      handleNodeLoopRerender(parentId)
  }, [collaborativeWorkflow, handleNodeLoopRerender])

  const handleNodeLoopChildrenCopy = useCallback((nodeId: string, newNodeId: string, idMapping: Record<string, string>) => {
    const { nodes } = collaborativeWorkflow.getState()
    const childrenNodes = getLoopChildren(nodes, nodeId)
    const newIdMapping = { ...idMapping }

    const copyChildren = childrenNodes.map((child, index) => {
      const childNodeType = child.data.type as BlockEnum
      const defaultValue = nodesMetaDataMap?.[childNodeType]?.defaultValue ?? {}
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
  }, [collaborativeWorkflow, nodesMetaDataMap])

  return {
    handleNodeLoopRerender,
    handleNodeLoopChildDrag,
    handleNodeLoopChildSizeChange,
    handleNodeLoopChildrenCopy,
  }
}
