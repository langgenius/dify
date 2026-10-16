import type { Type } from '../nodes/llm/types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import {
  getVarType,
  toNodeAvailableVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'
import { useWorkflowStore } from '../store'

export const useWorkflowVariables = () => {
  const { t } = useTranslation(['workflow'] as const)
  const workflowStore = useWorkflowStore()
  const { schemaTypeDefinitions } = useMatchSchemaType()

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const getNodeAvailableVars = useCallback(
    ({
      parentNode,
      beforeNodes,
      isChatflow,
      filterVar,
      hideEnv,
      hideChatVar,
    }: {
      parentNode?: Node | null
      beforeNodes: Node[]
      isChatflow: boolean
      filterVar: (payload: Var, selector: ValueSelector) => boolean
      hideEnv?: boolean
      hideChatVar?: boolean
    }): NodeOutPutVar[] => {
      const { conversationVariables, environmentVariables, ragPipelineVariables, dataSourceList } =
        workflowStore.getState()
      return toNodeAvailableVars({
        parentNode,
        t,
        beforeNodes,
        isChatflow,
        environmentVariables: hideEnv ? [] : environmentVariables,
        conversationVariables: isChatflow && !hideChatVar ? conversationVariables : [],
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
    },
    [t, workflowStore, schemaTypeDefinitions, buildInTools, customTools, workflowTools, mcpTools],
  )

  const getCurrentVariableType = useCallback(
    ({
      parentNode,
      valueSelector,
      isIterationItem,
      isLoopItem,
      availableNodes,
      isChatflow,
      isConstant,
      preferSchemaType,
    }: {
      valueSelector: ValueSelector
      parentNode?: Node | null
      isIterationItem?: boolean
      isLoopItem?: boolean
      availableNodes: any[]
      isChatflow: boolean
      isConstant?: boolean
      preferSchemaType?: boolean
    }) => {
      const { conversationVariables, environmentVariables, ragPipelineVariables, dataSourceList } =
        workflowStore.getState()
      return getVarType({
        parentNode,
        valueSelector,
        isIterationItem,
        isLoopItem,
        availableNodes,
        isChatflow,
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
    },
    [workflowStore, schemaTypeDefinitions, buildInTools, customTools, workflowTools, mcpTools],
  )

  return {
    getNodeAvailableVars,
    getCurrentVariableType,
  }
}

export const useWorkflowVariableType = () => {
  const store = useStoreApi()
  const { getNodes } = store.getState()
  const { getCurrentVariableType } = useWorkflowVariables()

  const isChatflow = useAtomValue(isChatflowAtom)

  const getVarType = ({
    nodeId,
    valueSelector,
  }: {
    nodeId: string
    valueSelector: ValueSelector
  }) => {
    const node = getNodes().find((n) => n.id === nodeId)
    const isInIteration = !!node?.data.isInIteration
    const iterationNode = isInIteration ? getNodes().find((n) => n.id === node.parentId) : null
    const availableNodes = [node]

    const type = getCurrentVariableType({
      parentNode: iterationNode,
      valueSelector,
      availableNodes,
      isChatflow,
      isConstant: false,
    })
    return type as unknown as Type
  }

  return getVarType
}
