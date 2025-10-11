import { useCallback } from 'react'
import {
  useStoreApi,
} from 'reactflow'
import { uniqBy } from 'lodash-es'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '../../hooks'
import type {
  Node,
  Var,
} from '../../types'
import { AssignerNodeInputType, WriteMode } from './types'

export const useGetAvailableVars = () => {
  const store = useStoreApi()
  const { getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const getAvailableVars = useCallback((nodeId: string, handleId: string, filterVar: (v: Var) => boolean, hideEnv = false) => {
    const availableNodes: Node[] = []
    const { getNodes } = store.getState()
    const nodes = getNodes()
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
        hideChatVar: hideEnv,
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
  }, [store, getBeforeNodesInSameBranchIncludeParent, getNodeAvailableVars, isChatMode])

  return getAvailableVars
}

export const useHandleAddOperationItem = () => {
  return useCallback((list: any[]) => {
    const newItem = {
      variable_selector: [],
      write_mode: WriteMode.overwrite,
      input_type: AssignerNodeInputType.variable,
      value: '',
    }
    return [...list, newItem]
  }, [])
}
