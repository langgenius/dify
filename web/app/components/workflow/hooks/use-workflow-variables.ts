import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { getVarType, toNodeAvailableVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { useIsChatMode } from './use-workflow'
import { useStoreApi } from 'reactflow'

export const useWorkflowVariables = () => {
  const { t } = useTranslation()
  const environmentVariables = useStore(s => s.environmentVariables)
  const conversationVariables = useStore(s => s.conversationVariables)

  const getNodeAvailableVars = useCallback(({
    parentNode,
    beforeNodes,
    isChatMode,
    filterVar,
    hideEnv,
    hideChatVar,
  }: {
    parentNode?: Node | null
    beforeNodes: Node[]
    isChatMode: boolean
    filterVar: (payload: Var, selector: ValueSelector) => boolean
    hideEnv?: boolean
    hideChatVar?: boolean
  }): NodeOutPutVar[] => {
    return toNodeAvailableVars({
      parentNode,
      t,
      beforeNodes,
      isChatMode,
      environmentVariables: hideEnv ? [] : environmentVariables,
      conversationVariables: (isChatMode && !hideChatVar) ? conversationVariables : [],
      filterVar,
    })
  }, [conversationVariables, environmentVariables, t])

  const getCurrentVariableType = useCallback(({
    parentNode,
    valueSelector,
    isIterationItem,
    isLoopItem,
    availableNodes,
    isChatMode,
    isConstant,
  }: {
    valueSelector: ValueSelector
    parentNode?: Node | null
    isIterationItem?: boolean
    isLoopItem?: boolean
    availableNodes: any[]
    isChatMode: boolean
    isConstant?: boolean
  }) => {
    return getVarType({
      parentNode,
      valueSelector,
      isIterationItem,
      isLoopItem,
      availableNodes,
      isChatMode,
      isConstant,
      environmentVariables,
      conversationVariables,
    })
  }, [conversationVariables, environmentVariables])

  return {
    getNodeAvailableVars,
    getCurrentVariableType,
  }
}

export const useWorkflowVariableType = () => {
  const store = useStoreApi()
  const {
    getNodes,
  } = store.getState()
  const { getCurrentVariableType } = useWorkflowVariables()

  const isChatMode = useIsChatMode()

  const getVarType = ({
    nodeId,
    valueSelector,
  }: {
    nodeId: string,
    valueSelector: ValueSelector,
  }) => {
    const node = getNodes().find(n => n.id === nodeId)
    const isInIteration = !!node?.data.isInIteration
    const iterationNode = isInIteration ? getNodes().find(n => n.id === node.parentId) : null
    const availableNodes = [node]

    const type = getCurrentVariableType({
      parentNode: iterationNode,
      valueSelector,
      availableNodes,
      isChatMode,
      isConstant: false,
    })
    return type
  }

  return getVarType
}
