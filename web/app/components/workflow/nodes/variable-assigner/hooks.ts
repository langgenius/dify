import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import { useWorkflow } from '../../hooks'
import { ITERATION_CHILDREN_Z_INDEX } from '../../constants'
import { BlockEnum } from '../../types'

export const useVariableAssigner = () => {
  const store = useStoreApi()
  const { getAfterNodesInSameBranch } = useWorkflow()

  const handleAddVariableInAddVariablePopupWithPosition = useCallback((
    nodeId: string,
    variableAssignerNodeId: string,
  ) => {
    const {
      edges,
      setEdges,
    } = store.getState()
    const afterNodes = getAfterNodesInSameBranch(nodeId)
    const lastNode = afterNodes[afterNodes.length - 1]
    const lastNodeNoConnection = edges.find(edge => edge.source === lastNode.id && edge.target === variableAssignerNodeId)

    if (!lastNodeNoConnection) {
      const newEdges = produce(edges, (draft) => {
        draft.push({
          id: `${lastNode.id}-${variableAssignerNodeId}`,
          type: 'custom',
          source: lastNode.id,
          sourceHandle: 'source',
          target: variableAssignerNodeId,
          targetHandle: 'target',
          data: {
            sourceType: lastNode.data.type,
            targetType: BlockEnum.VariableAssigner,
            isInIteration: !!lastNode.parentId,
          },
          zIndex: lastNode.parentId ? ITERATION_CHILDREN_Z_INDEX : 0,
        })
      })
      setEdges(newEdges)
    }
  }, [store, getAfterNodesInSameBranch])

  return {
    handleAddVariableInAddVariablePopupWithPosition,
  }
}
