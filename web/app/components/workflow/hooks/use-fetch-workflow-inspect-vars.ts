import type { Node, ToolWithProvider } from '@/app/components/workflow/types'
import type { SchemaTypeDefinition } from '@/service/use-common'
import type { FlowType } from '@/types/common'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { InteractionMode } from '@/app/components/workflow'
import { useNodesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-nodes-interactions-without-sync'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useInvalidateConversationVarValues, useInvalidateSysVarValues } from '@/service/use-workflow'
import { fetchAllInspectVars } from '@/service/workflow'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'
import { isValueSelectorInNodeOutputVars, toNodeOutputVars } from '../nodes/_base/components/variable/utils'
import { applyAgentSubgraphInspectVars } from './inspect-vars-agent-alias'

type Params = {
  flowType: FlowType
  flowId: string
  interactionMode?: InteractionMode
}

export const useSetWorkflowVarsWithValue = ({
  flowType,
  flowId,
  interactionMode,
}: Params) => {
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()
  const invalidateConversationVarValues = useInvalidateConversationVarValues(flowType, flowId)
  const invalidateSysVarValues = useInvalidateSysVarValues(flowType, flowId)
  const { handleCancelAllNodeSuccessStatus } = useNodesInteractionsWithoutSync()
  const { schemaTypeDefinitions } = useMatchSchemaType()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const parentAvailableNodesFromStore = useStore(s => s.parentAvailableNodes)
  const parentAvailableNodes = useMemo(() => parentAvailableNodesFromStore || [], [parentAvailableNodesFromStore])

  const allPluginInfoList = useMemo(() => {
    return {
      buildInTools: buildInTools || [],
      customTools: customTools || [],
      workflowTools: workflowTools || [],
      mcpTools: mcpTools || [],
      dataSourceList: dataSourceList || [],
    }
  }, [buildInTools, customTools, workflowTools, mcpTools, dataSourceList])

  const setInspectVarsToStore = useCallback((inspectVars: VarInInspect[], passedInAllPluginInfoList?: Record<string, ToolWithProvider[]>, passedInSchemaTypeDefinitions?: SchemaTypeDefinition[]) => {
    const { setNodesWithInspectVars } = workflowStore.getState()
    const { getNodes } = store.getState()

    const nodeArr = getNodes()
    const parentNodeIds = new Set(parentAvailableNodes.map(node => node.id))
    const nodeMap = new Map(nodeArr.map(node => [node.id, node]))
    parentAvailableNodes.forEach((node) => {
      if (!nodeMap.has(node.id))
        nodeMap.set(node.id, node)
    })
    const allNodes = Array.from(nodeMap.values())
    const allNodesOutputVars = toNodeOutputVars(allNodes, false, () => true, [], [], [], passedInAllPluginInfoList || allPluginInfoList, passedInSchemaTypeDefinitions || schemaTypeDefinitions)

    const nodesKeyValue: Record<string, Node> = {}
    allNodes.forEach((node) => {
      nodesKeyValue[node.id] = node
    })

    const withValueNodeIds: Record<string, boolean> = {}
    inspectVars.forEach((varItem) => {
      const nodeId = varItem.selector[0]
      const node = nodesKeyValue[nodeId]
      if (!node)
        return
      withValueNodeIds[nodeId] = true
    })

    const withValueNodes = Object.keys(withValueNodeIds).map((nodeId) => {
      return nodesKeyValue[nodeId]
    })

    const resolvedInteractionMode = interactionMode ?? InteractionMode.Default
    const nodesWithVars: NodeWithVar[] = withValueNodes.map((node) => {
      const nodeId = node.id
      const isParentNode = resolvedInteractionMode === InteractionMode.Subgraph && parentNodeIds.has(nodeId)
      const nodeVar = allNodesOutputVars.find(item => item.nodeId === nodeId)
      const varsUnderTheNode = inspectVars.filter((varItem) => {
        if (varItem.selector[0] !== nodeId)
          return false
        if (!nodeVar)
          return false
        return isValueSelectorInNodeOutputVars(varItem.selector, [nodeVar])
      })

      return {
        nodeId,
        nodePayload: node.data,
        nodeType: node.data.type,
        title: node.data.title,
        vars: varsUnderTheNode.map((item) => {
          const schemaType = nodeVar ? nodeVar.vars.find(v => v.variable === item.name)?.schemaType : ''
          return {
            ...item,
            schemaType,
          }
        }),
        isSingRunRunning: false,
        isValueFetched: false,
        isHidden: isParentNode,
      }
    })

    const shouldApplyAlias = resolvedInteractionMode !== InteractionMode.Subgraph
    const nextNodes = shouldApplyAlias ? applyAgentSubgraphInspectVars(nodesWithVars, allNodes) : nodesWithVars
    setNodesWithInspectVars(nextNodes)
  }, [workflowStore, store, parentAvailableNodes, allPluginInfoList, schemaTypeDefinitions, interactionMode])

  const fetchInspectVars = useCallback(async (params: {
    passInVars?: boolean
    vars?: VarInInspect[]
    passedInAllPluginInfoList?: Record<string, ToolWithProvider[]>
    passedInSchemaTypeDefinitions?: SchemaTypeDefinition[]
  }) => {
    const { passInVars, vars, passedInAllPluginInfoList, passedInSchemaTypeDefinitions } = params
    invalidateConversationVarValues()
    invalidateSysVarValues()
    const data = passInVars ? vars! : await fetchAllInspectVars(flowType, flowId)
    setInspectVarsToStore(data, passedInAllPluginInfoList, passedInSchemaTypeDefinitions)
    handleCancelAllNodeSuccessStatus() // to make sure clear node output show the unset status
  }, [invalidateConversationVarValues, invalidateSysVarValues, flowType, flowId, setInspectVarsToStore, handleCancelAllNodeSuccessStatus])

  return {
    fetchInspectVars,
  }
}
