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
import { useStore } from '@/app/components/workflow/store'
import type { Type } from '../nodes/llm/types'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'

export const useWorkflowVariables = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const { schemaTypeDefinitions } = useMatchSchemaType()

  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)
  const dataSourceList = useStore(s => s.dataSourceList)
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
        buildInTools,
        customTools,
        workflowTools,
        mcpTools,
        dataSourceList: dataSourceList ?? [],
      },
      schemaTypeDefinitions,
    })
  }, [t, workflowStore, schemaTypeDefinitions, buildInTools])

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
      buildInTools,
      customTools,
      workflowTools,
      mcpTools,
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
        buildInTools,
        customTools,
        workflowTools,
        mcpTools,
        dataSourceList: dataSourceList ?? [],
      },
      schemaTypeDefinitions,
      preferSchemaType,
    })
  }, [workflowStore, getVarType, schemaTypeDefinitions])

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
