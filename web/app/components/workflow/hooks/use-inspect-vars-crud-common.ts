import { fetchNodeInspectVars } from '@/service/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import type { ValueSelector } from '@/app/components/workflow/types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import { useCallback } from 'react'
import {
  isConversationVar,
  isENV,
  isSystemVar,
  toNodeOutputVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { produce } from 'immer'
import type { Node } from '@/app/components/workflow/types'
import { useNodesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-nodes-interactions-without-sync'
import { useEdgesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-edges-interactions-without-sync'
import type { FlowType } from '@/types/common'
import useFLow from '@/service/use-flow'
import { useStoreApi } from 'reactflow'
import type { SchemaTypeDefinition } from '@/service/use-common'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'

type Params = {
  flowId: string
  flowType: FlowType
}
export const useInspectVarsCrudCommon = ({
  flowId,
  flowType,
}: Params) => {
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()
  const {
    useInvalidateConversationVarValues,
    useInvalidateSysVarValues,
    useResetConversationVar,
    useResetToLastRunValue,
    useDeleteAllInspectorVars,
    useDeleteNodeInspectorVars,
    useDeleteInspectVar,
    useEditInspectorVar,
  } = useFLow({ flowType })
  const invalidateConversationVarValues = useInvalidateConversationVarValues(flowId)
  const { mutateAsync: doResetConversationVar } = useResetConversationVar(flowId)
  const { mutateAsync: doResetToLastRunValue } = useResetToLastRunValue(flowId)
  const invalidateSysVarValues = useInvalidateSysVarValues(flowId)

  const { mutateAsync: doDeleteAllInspectorVars } = useDeleteAllInspectorVars(flowId)
  const { mutate: doDeleteNodeInspectorVars } = useDeleteNodeInspectorVars(flowId)
  const { mutate: doDeleteInspectVar } = useDeleteInspectVar(flowId)

  const { mutateAsync: doEditInspectorVar } = useEditInspectorVar(flowId)
  const { handleCancelNodeSuccessStatus } = useNodesInteractionsWithoutSync()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const getNodeInspectVars = useCallback((nodeId: string) => {
    const { nodesWithInspectVars } = workflowStore.getState()
    const node = nodesWithInspectVars.find(node => node.nodeId === nodeId)
    return node
  }, [workflowStore])

  const getVarId = useCallback((nodeId: string, varName: string) => {
    const node = getNodeInspectVars(nodeId)
    if (!node)
      return undefined
    const varId = node.vars.find((varItem) => {
      return varItem.selector[1] === varName
    })?.id
    return varId
  }, [getNodeInspectVars])

  const getInspectVar = useCallback((nodeId: string, name: string): VarInInspect | undefined => {
    const node = getNodeInspectVars(nodeId)
    if (!node)
      return undefined

    const variable = node.vars.find((varItem) => {
      return varItem.name === name
    })
    return variable
  }, [getNodeInspectVars])

  const hasSetInspectVar = useCallback((nodeId: string, name: string, sysVars: VarInInspect[], conversationVars: VarInInspect[]) => {
    const isEnv = isENV([nodeId])
    if (isEnv) // always have value
      return true
    const isSys = isSystemVar([nodeId])
    if (isSys)
      return sysVars.some(varItem => varItem.selector?.[1]?.replace('sys.', '') === name)
    const isChatVar = isConversationVar([nodeId])
    if (isChatVar)
      return conversationVars.some(varItem => varItem.selector?.[1] === name)
    return getInspectVar(nodeId, name) !== undefined
  }, [getInspectVar])

  const hasNodeInspectVars = useCallback((nodeId: string) => {
    return !!getNodeInspectVars(nodeId)
  }, [getNodeInspectVars])

  const fetchInspectVarValue = useCallback(async (selector: ValueSelector, schemaTypeDefinitions: SchemaTypeDefinition[]) => {
    const {
      setNodeInspectVars,
      dataSourceList,
    } = workflowStore.getState()
    const nodeId = selector[0]
    const isSystemVar = nodeId === 'sys'
    const isConversationVar = nodeId === 'conversation'
    if (isSystemVar) {
      invalidateSysVarValues()
      return
    }
    if (isConversationVar) {
      invalidateConversationVarValues()
      return
    }
    const { getNodes } = store.getState()
    const nodeArr = getNodes()
    const currentNode = nodeArr.find(node => node.id === nodeId)
    const allPluginInfoList = {
      buildInTools: buildInTools || [],
      customTools: customTools || [],
      workflowTools: workflowTools || [],
      mcpTools: mcpTools || [],
      dataSourceList: dataSourceList || [],
    }
    const currentNodeOutputVars = toNodeOutputVars([currentNode], false, () => true, [], [], [], allPluginInfoList, schemaTypeDefinitions)
    const vars = await fetchNodeInspectVars(flowType, flowId, nodeId)
    const varsWithSchemaType = vars.map((varItem) => {
      const schemaType = currentNodeOutputVars[0]?.vars.find(v => v.variable === varItem.name)?.schemaType || ''
      return {
        ...varItem,
        schemaType,
      }
    })
    setNodeInspectVars(nodeId, varsWithSchemaType)
  }, [workflowStore, flowType, flowId, invalidateSysVarValues, invalidateConversationVarValues, buildInTools, customTools, workflowTools, mcpTools])

  // after last run would call this
  const appendNodeInspectVars = useCallback((nodeId: string, payload: VarInInspect[], allNodes: Node[]) => {
    const {
      nodesWithInspectVars,
      setNodesWithInspectVars,
    } = workflowStore.getState()
    const nodes = produce(nodesWithInspectVars, (draft) => {
      const nodeInfo = allNodes.find(node => node.id === nodeId)
      if (nodeInfo) {
        const index = draft.findIndex(node => node.nodeId === nodeId)
        if (index === -1) {
          draft.unshift({
            nodeId,
            nodeType: nodeInfo.data.type,
            title: nodeInfo.data.title,
            vars: payload,
            nodePayload: nodeInfo.data,
          })
        }
        else {
          draft[index].vars = payload
          // put the node to the topAdd commentMore actions
          draft.unshift(draft.splice(index, 1)[0])
        }
      }
    })
    setNodesWithInspectVars(nodes)
    handleCancelNodeSuccessStatus(nodeId)
  }, [workflowStore, handleCancelNodeSuccessStatus])

  const hasNodeInspectVar = useCallback((nodeId: string, varId: string) => {
    const { nodesWithInspectVars } = workflowStore.getState()
    const targetNode = nodesWithInspectVars.find(item => item.nodeId === nodeId)
    if (!targetNode || !targetNode.vars)
      return false
    return targetNode.vars.some(item => item.id === varId)
  }, [workflowStore])

  const deleteInspectVar = useCallback(async (nodeId: string, varId: string) => {
    const { deleteInspectVar } = workflowStore.getState()
    if (hasNodeInspectVar(nodeId, varId)) {
      await doDeleteInspectVar(varId)
      deleteInspectVar(nodeId, varId)
    }
  }, [doDeleteInspectVar, workflowStore, hasNodeInspectVar])

  const resetConversationVar = useCallback(async (varId: string) => {
    await doResetConversationVar(varId)
    invalidateConversationVarValues()
  }, [doResetConversationVar, invalidateConversationVarValues])

  const deleteNodeInspectorVars = useCallback(async (nodeId: string) => {
    const { deleteNodeInspectVars } = workflowStore.getState()
    if (hasNodeInspectVars(nodeId)) {
      await doDeleteNodeInspectorVars(nodeId)
      deleteNodeInspectVars(nodeId)
    }
  }, [doDeleteNodeInspectorVars, workflowStore, hasNodeInspectVars])

  const deleteAllInspectorVars = useCallback(async () => {
    const { deleteAllInspectVars } = workflowStore.getState()
    await doDeleteAllInspectorVars()
    await invalidateConversationVarValues()
    await invalidateSysVarValues()
    deleteAllInspectVars()
    handleEdgeCancelRunningStatus()
  }, [doDeleteAllInspectorVars, invalidateConversationVarValues, invalidateSysVarValues, workflowStore, handleEdgeCancelRunningStatus])

  const editInspectVarValue = useCallback(async (nodeId: string, varId: string, value: any) => {
    const { setInspectVarValue } = workflowStore.getState()
    await doEditInspectorVar({
      varId,
      value,
    })
    setInspectVarValue(nodeId, varId, value)
    if (nodeId === VarInInspectType.conversation)
      invalidateConversationVarValues()
    if (nodeId === VarInInspectType.system)
      invalidateSysVarValues()
  }, [doEditInspectorVar, invalidateConversationVarValues, invalidateSysVarValues, workflowStore])

  const renameInspectVarName = useCallback(async (nodeId: string, oldName: string, newName: string) => {
    const { renameInspectVarName } = workflowStore.getState()
    const varId = getVarId(nodeId, oldName)
    if (!varId)
      return

    const newSelector = [nodeId, newName]
    await doEditInspectorVar({
      varId,
      name: newName,
    })
    renameInspectVarName(nodeId, varId, newSelector)
  }, [doEditInspectorVar, getVarId, workflowStore])

  const isInspectVarEdited = useCallback((nodeId: string, name: string) => {
    const inspectVar = getInspectVar(nodeId, name)
    if (!inspectVar)
      return false

    return inspectVar.edited
  }, [getInspectVar])

  const resetToLastRunVar = useCallback(async (nodeId: string, varId: string) => {
    const { resetToLastRunVar } = workflowStore.getState()
    const isSysVar = nodeId === 'sys'
    const data = await doResetToLastRunValue(varId)

    if (isSysVar)
      invalidateSysVarValues()
    else
      resetToLastRunVar(nodeId, varId, data.value)
  }, [doResetToLastRunValue, invalidateSysVarValues, workflowStore])

  return {
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
  }
}
