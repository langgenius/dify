import type { Node, WorkflowPluginCatalogs } from '@/app/components/workflow/types'
import type { SchemaTypeDefinition } from '@/service/use-common'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import {
  useInvalidateConversationVarValues,
  useInvalidateSysVarValues,
} from '@/service/use-workflow'
import { fetchAllInspectVars } from '@/service/workflow'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'
import { toNodeOutputVars } from '../nodes/_base/components/variable/utils'
import { useNodesInteractionsWithoutSync } from './use-nodes-interactions-without-sync'

export const useSetWorkflowVarsWithValue = () => {
  const resource = useAtomValue(editorResourceAtom)
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()
  const invalidateConversationVarValues = useInvalidateConversationVarValues(resource)
  const invalidateSysVarValues = useInvalidateSysVarValues(resource)
  const { handleCancelAllNodeSuccessStatus } = useNodesInteractionsWithoutSync()
  const { schemaTypeDefinitions } = useMatchSchemaType()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore((s) => s.dataSourceList)

  const allPluginInfoList = useMemo(() => {
    return {
      buildInTools: buildInTools || [],
      customTools: customTools || [],
      workflowTools: workflowTools || [],
      mcpTools: mcpTools || [],
      dataSourceList: dataSourceList || [],
    }
  }, [buildInTools, customTools, workflowTools, mcpTools, dataSourceList])

  const setInspectVarsToStore = useCallback(
    (
      inspectVars: VarInInspect[],
      passedInAllPluginInfoList?: WorkflowPluginCatalogs,
      passedInSchemaTypeDefinitions?: SchemaTypeDefinition[],
    ) => {
      const { setNodesWithInspectVars } = workflowStore.getState()
      const { getNodes } = store.getState()

      const nodeArr = getNodes()
      const allNodesOutputVars = toNodeOutputVars(
        nodeArr,
        false,
        () => true,
        [],
        [],
        [],
        passedInAllPluginInfoList || allPluginInfoList,
        passedInSchemaTypeDefinitions || schemaTypeDefinitions,
      )

      const nodesKeyValue: Record<string, Node> = {}
      nodeArr.forEach((node) => {
        nodesKeyValue[node.id] = node
      })

      const withValueNodeIds: Record<string, boolean> = {}
      inspectVars.forEach((varItem) => {
        const nodeId = varItem.selector[0]

        const node = nodesKeyValue[nodeId!]
        if (!node) return
        withValueNodeIds[nodeId!] = true
      })
      const withValueNodes = Object.keys(withValueNodeIds).map((nodeId) => {
        return nodesKeyValue[nodeId]
      })

      const res: NodeWithVar[] = withValueNodes.map((node) => {
        const nodeId = node!.id
        const varsUnderTheNode = inspectVars.filter((varItem) => {
          return varItem.selector[0] === nodeId
        })
        const nodeVar = allNodesOutputVars.find((item) => item.nodeId === nodeId)

        const nodeWithVar = {
          nodeId,
          nodePayload: node!.data,
          nodeType: node!.data.type,
          title: node!.data.title,
          vars: varsUnderTheNode.map((item) => {
            const schemaType = nodeVar
              ? nodeVar.vars.find((v) => v.variable === item.name)?.schemaType
              : ''
            return {
              ...item,
              schemaType,
            }
          }),
          isSingRunRunning: false,
          isValueFetched: false,
        }
        return nodeWithVar
      })
      setNodesWithInspectVars(res)
    },
    [workflowStore, store, allPluginInfoList, schemaTypeDefinitions],
  )

  const fetchInspectVars = useCallback(
    async (params: {
      passInVars?: boolean
      vars?: VarInInspect[]
      passedInAllPluginInfoList?: WorkflowPluginCatalogs
      passedInSchemaTypeDefinitions?: SchemaTypeDefinition[]
    }) => {
      const { passInVars, vars, passedInAllPluginInfoList, passedInSchemaTypeDefinitions } = params
      invalidateConversationVarValues()
      invalidateSysVarValues()
      const data = passInVars ? vars! : await fetchAllInspectVars(resource)
      setInspectVarsToStore(data, passedInAllPluginInfoList, passedInSchemaTypeDefinitions)
      handleCancelAllNodeSuccessStatus() // to make sure clear node output show the unset status
    },
    [
      invalidateConversationVarValues,
      invalidateSysVarValues,
      resource,
      setInspectVarsToStore,
      handleCancelAllNodeSuccessStatus,
    ],
  )

  return {
    fetchInspectVars,
  }
}
