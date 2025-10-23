import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '../store'
import { getVarType, toNodeAvailableVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { useIsChatMode } from './use-workflow'
import { useStoreApi } from 'reactflow'
import type { Type } from '../nodes/llm/types'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'

export const useWorkflowVariables = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const { schemaTypeDefinitions } = useMatchSchemaType()

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

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
    const {
      conversationVariables,
      environmentVariables,
      ragPipelineVariables,
      dataSourceList,
    } = workflowStore.getState()
    return toNodeAvailableVars({
      parentNode,
      t,
      beforeNodes,
      isChatMode,
      environmentVariables: hideEnv ? [] : environmentVariables,
      conversationVariables: (isChatMode && !hideChatVar) ? conversationVariables : [],
      ragVariables: ragPipelineVariables,
      filterVar,
      allPluginInfoList: {
        buildInTools: buildInTools || [],
        customTools: customTools || [],
        workflowTools: workflowTools || [],
        mcpTools: mcpTools || [],
        dataSourceList: dataSourceList || [],
      },
      schemaTypeDefinitions,
    })
  }, [t, workflowStore, schemaTypeDefinitions, buildInTools, customTools, workflowTools, mcpTools])

  const getCurrentVariableType = useCallback(({
    parentNode,
    valueSelector,
    isIterationItem,
    isLoopItem,
    availableNodes,
    isChatMode,
    isConstant,
    preferSchemaType,
  }: {
    valueSelector: ValueSelector
    parentNode?: Node | null
    isIterationItem?: boolean
    isLoopItem?: boolean
    availableNodes: any[]
    isChatMode: boolean
    isConstant?: boolean
    preferSchemaType?: boolean
  }) => {
    const {
      conversationVariables,
      environmentVariables,
      ragPipelineVariables,
      dataSourceList,
    } = workflowStore.getState()
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
      ragVariables: ragPipelineVariables,
      allPluginInfoList: {
        buildInTools: buildInTools || [],
        customTools: customTools || [],
        workflowTools: workflowTools || [],
        mcpTools: mcpTools || [],
        dataSourceList: dataSourceList ?? [],
      },
      schemaTypeDefinitions,
      preferSchemaType,
    })
  }, [workflowStore, getVarType, schemaTypeDefinitions, buildInTools, customTools, workflowTools, mcpTools])

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
    return type as unknown as Type
  }

  return getVarType
}
