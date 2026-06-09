import type {
  BlockEnum,
  ChildNodeTypeCount,
  Node,
} from '../../types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodesMetaData } from '@/app/components/workflow/hooks'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import {
  generateNewNode,
  getNodeCustomTypeByNodeDataType,
} from '../../utils'
import {
  buildIterationChildCopy,
  getIterationChildren,
  getIterationContainerBounds,
  getIterationContainerResize,
  getNextChildNodeTypeCount,
  getRestrictedIterationPosition,
} from './use-interactions.helpers'

export const useNodeIterationInteractions = () => {
  const { t } = useTranslation()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleNodeIterationRerender = useCallback((nodeId: string) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()

    const currentNode = nodes.find(n => n.id === nodeId)!
    const childrenNodes = nodes.filter(n => n.parentId === nodeId)
    const resize = getIterationContainerResize(currentNode, getIterationContainerBounds(childrenNodes))

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

  const handleNodeIterationChildDrag = useCallback((node: Node) => {
    const { nodes } = collaborativeWorkflow.getState()

    return {
      restrictPosition: getRestrictedIterationPosition(node, nodes.find(n => n.id === node.parentId)),
    }
  }, [collaborativeWorkflow])

  const handleNodeIterationChildSizeChange = useCallback((nodeId: string) => {
    const { nodes } = collaborativeWorkflow.getState()
    const currentNode = nodes.find(n => n.id === nodeId)!
    const parentId = currentNode.parentId

    if (parentId)
      handleNodeIterationRerender(parentId)
  }, [collaborativeWorkflow, handleNodeIterationRerender])

  const handleNodeIterationChildrenCopy = useCallback((nodeId: string, newNodeId: string, idMapping: Record<string, string>) => {
    const { nodes } = collaborativeWorkflow.getState()
    const childrenNodes = getIterationChildren(nodes, nodeId)
    const newIdMapping = { ...idMapping }
    const childNodeTypeCount: ChildNodeTypeCount = {}

    const copyChildren = childrenNodes.map((child, index) => {
      const childNodeType = child.data.type as BlockEnum
      const nodesWithSameType = nodes.filter(node => node.data.type === childNodeType)
      const nextCount = getNextChildNodeTypeCount(childNodeTypeCount, childNodeType, nodesWithSameType.length)
      const title = nodesWithSameType.length > 0
        ? `${t(`blocks.${childNodeType}`, { ns: 'workflow' })} ${nextCount}`
        : t(`blocks.${childNodeType}`, { ns: 'workflow' })
      const childCopy = buildIterationChildCopy({
        child,
        childNodeType,
        defaultValue: nodesMetaDataMap![childNodeType].defaultValue as Node['data'],
        title,
        newNodeId,
      })
      const { newNode } = generateNewNode({
        ...childCopy,
        type: getNodeCustomTypeByNodeDataType(childNodeType),
      })
      newNode.id = `${newNodeId}${newNode.id + index}`
      newIdMapping[child.id] = newNode.id
      return newNode
    })

    return {
      copyChildren,
      newIdMapping,
    }
  }, [nodesMetaDataMap, collaborativeWorkflow, t])

  return {
    handleNodeIterationRerender,
    handleNodeIterationChildDrag,
    handleNodeIterationChildSizeChange,
    handleNodeIterationChildrenCopy,
  }
}
