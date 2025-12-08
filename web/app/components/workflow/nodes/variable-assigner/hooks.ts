import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { useNodes } from 'reactflow'

import { uniqBy } from 'lodash-es'
import { produce } from 'immer'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
  useWorkflowVariables,
} from '../../hooks'
import type {
  Node,
  ValueSelector,
  Var,
} from '../../types'
import { useWorkflowStore } from '../../store'
import type {
  VarGroupItem,
  VariableAssignerNodeType,
} from './types'

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
    handleGroupItemMouseEnter,
    handleGroupItemMouseLeave,
    handleAssignVariableValueChange,
  }
}

export const useGetAvailableVars = () => {
  const nodes: Node[] = useNodes()
  const { getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const getAvailableVars = useCallback((nodeId: string, handleId: string, filterVar: (v: Var) => boolean, hideEnv = false) => {
    const availableNodes: Node[] = []
    const currentNode = nodes.find(node => node.id === nodeId)!

    if (!currentNode)
      return []
    const beforeNodes = getBeforeNodesInSameBranchIncludeParent(nodeId)
    availableNodes.push(...beforeNodes)
    const parentNode = nodes.find(node => node.id === currentNode.parentId)

    if (hideEnv) {
      return getNodeAvailableVars({
        parentNode,
        beforeNodes: uniqBy(availableNodes, 'id').filter(node => node.id !== nodeId),
        isChatMode,
        hideEnv,
        hideChatVar: false,
        filterVar,
      })
        .map(node => ({
          ...node,
          vars: node.isStartNode ? node.vars.filter(v => !v.variable.startsWith('sys.')) : node.vars,
        }))
        .filter(item => item.vars.length > 0)
    }

    return getNodeAvailableVars({
      parentNode,
      beforeNodes: uniqBy(availableNodes, 'id').filter(node => node.id !== nodeId),
      isChatMode,
      filterVar,
    })
  }, [nodes, getBeforeNodesInSameBranchIncludeParent, getNodeAvailableVars, isChatMode])

  return getAvailableVars
}
