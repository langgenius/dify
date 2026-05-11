import type { OnSelectBlock } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useNodesMetaData } from '@/app/components/workflow/hooks'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { generateNewNode } from '@/app/components/workflow/utils'

export const useReplaceDataSourceNode = (id: string) => {
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

  const handleReplaceNode = useCallback<OnSelectBlock>((
    type,
    pluginDefaultValue,
  ) => {
    const {
      nodes,
      setNodes,
    } = collaborativeWorkflow.getState()
    const emptyNodeIndex = nodes.findIndex(node => node.id === id)

    if (emptyNodeIndex < 0)
      return
    const nodeMetaData = nodesMetaDataMap?.[type]
    if (!nodeMetaData)
      return
    const { defaultValue } = nodeMetaData
    const emptyNode = nodes[emptyNodeIndex]
    const { newNode } = generateNewNode({
      data: {
        ...(defaultValue as any),
        ...pluginDefaultValue,
      },
      position: {
        x: emptyNode!.position.x,
        y: emptyNode!.position.y,
      },
    })
    const newNodes = produce(nodes, (draft) => {
      draft[emptyNodeIndex] = newNode
    })
    const newNodesWithoutTempNodes = produce(newNodes, (draft) => {
      return draft.filter(node => !node.data._isTempNode)
    })
    setNodes(newNodesWithoutTempNodes)
  }, [collaborativeWorkflow, id, nodesMetaDataMap])

  return {
    handleReplaceNode,
  }
}
