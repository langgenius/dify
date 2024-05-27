import { useCallback } from 'react'
import {
  useEdges,
  useNodes,
  useStoreApi,
} from 'reactflow'
import { useTranslation } from 'react-i18next'
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
  Var,
} from '../../types'
import { useWorkflowStore } from '../../store'
import type {
  VarGroupItem,
  VariableAssignerNodeType,
} from './types'
import { toNodeAvailableVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

export const useVariableAssigner = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { handleNodeDataUpdate } = useNodeDataUpdate()

  const handleAssignVariableValueChange = useCallback((nodeId: string, value: ValueSelector, varDetail: Var, groupId?: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes()
    const node: Node<VariableAssignerNodeType> = nodes.find(node => node.id === nodeId)!

    let payload
    if (groupId && groupId !== 'target') {
      payload = {
        advanced_settings: {
          ...node.data.advanced_settings,
          groups: node.data.advanced_settings?.groups.map((group: VarGroupItem & { groupId: string }) => {
            if (group.groupId === groupId && !group.variables.some(item => item.join('.') === (value as ValueSelector).join('.'))) {
              return {
                ...group,
                variables: [...group.variables, value],
                output_type: varDetail.type,
              }
            }
            return group
          }),
        },
      }
    }
    else {
      if (node.data.variables.some(item => item.join('.') === (value as ValueSelector).join('.')))
        return
      payload = {
        variables: [...node.data.variables, value],
        output_type: varDetail.type,
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
    variableAssignerNodeHandleId: string,
    value: ValueSelector,
    varDetail: Var,
  ) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const {
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
    handleAssignVariableValueChange(variableAssignerNodeId, value, varDetail, variableAssignerNodeHandleId)
  }, [store, workflowStore, handleAssignVariableValueChange])

  const handleRemoveEdges = useCallback((nodeId: string, enabled: boolean) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
    const needDeleteEdges = edges.filter(edge => edge.target === nodeId)

    if (!needDeleteEdges.length)
      return

    const currentNode = nodes.find(node => node.id === nodeId)!
    const groups = currentNode.data.advanced_settings?.groups || []

    let shouldKeepEdges: Edge[] = []

    if (enabled) {
      shouldKeepEdges = edges.filter((edge) => {
        return edge.target === nodeId && edge.targetHandle === 'target'
      }).map((edge) => {
        return {
          ...edge,
          targetHandle: groups[0].groupId,
        }
      })
    }
    else {
      shouldKeepEdges = edges.filter((edge) => {
        return edge.target === nodeId && edge.targetHandle === groups[0].groupId
      }).map((edge) => {
        return {
          ...edge,
          targetHandle: 'target',
        }
      })
    }

    const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
      [
        ...needDeleteEdges.map((needDeleteEdge) => {
          return {
            type: 'remove',
            edge: needDeleteEdge,
          }
        }),
        ...shouldKeepEdges.map((shouldKeepEdge) => {
          return {
            type: 'add',
            edge: shouldKeepEdge,
          }
        }),
      ],
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
    const newEdges = produce(edges, (draft) => {
      draft = draft.filter(edge => edge.target !== nodeId)
      draft.push(...shouldKeepEdges)
      return draft
    })
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
  const { t } = useTranslation()
  const nodes: Node[] = useNodes()
  const edges: Edge[] = useEdges()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const isChatMode = useIsChatMode()
  const getAvailableVars = useCallback((nodeId: string, handleId: string, filterVar: (v: Var) => boolean) => {
    const availableNodes: Node[] = []
    const currentNode = nodes.find(node => node.id === nodeId)!

    if (!currentNode)
      return []
    const parentNode = nodes.find(node => node.id === currentNode.parentId)
    const connectedEdges = edges.filter(edge => edge.target === nodeId && edge.targetHandle === handleId)

    if (parentNode && !connectedEdges.length) {
      const beforeNodes = getBeforeNodesInSameBranch(parentNode.id)
      availableNodes.push(...beforeNodes)
    }
    else {
      connectedEdges.forEach((connectedEdge) => {
        const beforeNodes = getBeforeNodesInSameBranch(connectedEdge.source)
        const connectedNode = nodes.find(node => node.id === connectedEdge.source)!

        availableNodes.push(connectedNode, ...beforeNodes)
      })
    }

    return toNodeAvailableVars({
      parentNode,
      t,
      beforeNodes: uniqBy(availableNodes, 'id').filter(node => node.id !== nodeId),
      isChatMode,
      filterVar,
    })
  }, [nodes, edges, t, isChatMode, getBeforeNodesInSameBranch])

  return getAvailableVars
}
