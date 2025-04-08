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
