import { useCallback } from 'react'
import {
  useEdges,
  useNodes,
  useStoreApi,
} from 'reactflow'
import { uniqBy } from 'lodash-es'
import produce from 'immer'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '../../hooks'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../../utils'
import type {
  Edge,
  Node,
  ValueSelector,
} from '../../types'
import { useWorkflowStore } from '../../store'
import { toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

export const useVariableAssigner = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { handleNodeDataUpdate } = useNodeDataUpdate()

  const handleAssignVariableValueChange = useCallback((nodeId: string, value: ValueSelector, groupId?: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const node = nodes.find(node => node.id === nodeId)!

    let payload
    if (groupId && groupId !== 'target') {
      payload = {
        advanced_settings: {
          ...node.data.advanced_settings,
          groups: node.data.advanced_settings.groups.map((group: any) => {
            if (group.groupId === groupId) {
              return {
                ...group,
                variables: [...group.variables, value],
              }
            }
            return group
          }),
        },
      }
    }
    else {
      payload = {
        variables: [...node.data.variables, value],
      }
    }
    handleNodeDataUpdate({
      id: nodeId,
      data: payload,
    })
  }, [store, handleNodeDataUpdate])

  const handleAddVariableInAddVariablePopupWithPosition = useCallback((
    nodeId: string,
    variableAssignerNodeId: string,
    value: ValueSelector,
  ) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const {
      hoveringAssignVariableGroupId,
      setShowAssignVariablePopup,
    } = workflowStore.getState()

    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        if (node.id === nodeId || node.id === variableAssignerNodeId) {
          node.data = {
            ...node.data,
            _showAddVariablePopup: false,
            _holdAddVariablePopup: false,
          }
        }
      })
    })
    setNodes(newNodes)
    setShowAssignVariablePopup(undefined)
    handleAssignVariableValueChange(variableAssignerNodeId, value, hoveringAssignVariableGroupId)
  }, [store, workflowStore, handleAssignVariableValueChange])

  const handleRemoveEdges = useCallback((nodeId: string) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const needDeleteEdges = edges.filter(edge => edge.target === nodeId)
    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      needDeleteEdges.map((needDeleteEdge) => {
        return {
          type: 'remove',
          edge: needDeleteEdge,
        }
      }),
      nodes,
    )

    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
          node.data = {
            ...node.data,
            ...nodesConnectedSourceOrTargetHandleIdsMap[node.id],
          }
        }
      })
    })
    setNodes(newNodes)
    const newEdges = edges.filter(edge => edge.target !== nodeId)
    setEdges(newEdges)
  }, [store])

  const handleGroupItemMouseEnter = useCallback((groupId: string) => {
    const {
      setHoveringAssignVariableGroupId,
    } = workflowStore.getState()

    setHoveringAssignVariableGroupId(groupId)
  }, [workflowStore])

  const handleGroupItemMouseLeave = useCallback(() => {
    const {
      connectingNodePayload,
      setHoveringAssignVariableGroupId,
    } = workflowStore.getState()

    if (connectingNodePayload)
      setHoveringAssignVariableGroupId(undefined)
  }, [workflowStore])

  return {
    handleAddVariableInAddVariablePopupWithPosition,
    handleRemoveEdges,
    handleGroupItemMouseEnter,
    handleGroupItemMouseLeave,
    handleAssignVariableValueChange,
  }
}

export const useGetAvailableVars = () => {
  const nodes: Node[] = useNodes()
  const edges: Edge[] = useEdges()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const isChatMode = useIsChatMode()
  const getAvailableVars = useCallback((nodeId: string, handleId: string) => {
    const availableNodes: Node[] = []
    const connectedEdges = edges.filter(edge => edge.target === nodeId && edge.targetHandle === handleId)

    connectedEdges.forEach((connectedEdge) => {
      const beforeNodes = getBeforeNodesInSameBranch(connectedEdge.source)
      const connectedNode = nodes.find(node => node.id === connectedEdge.source)!

      availableNodes.push(connectedNode, ...beforeNodes)
    })

    return toNodeOutputVars(uniqBy(availableNodes, 'id').filter(node => node.id !== nodeId), isChatMode, () => true)
  }, [nodes, edges, isChatMode, getBeforeNodesInSameBranch])

  return getAvailableVars
}
