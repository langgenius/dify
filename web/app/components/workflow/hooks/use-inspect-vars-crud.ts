import { fetchNodeInspectVars } from '@/service/workflow'
import { useWorkflowStore } from '../store'
import type { ValueSelector } from '../types'
import {
  useConversationVarValues,
  useDeleteAllInspectorVars,
  useDeleteInspectVar,
  useDeleteNodeInspectorVars,
  useEditInspectorVar,
  useInvalidateConversationVarValues,
  useInvalidateSysVarValues,
  useSysVarValues,
} from '@/service/use-workflow'

const useInspectVarsCrud = () => {
  const workflowStore = useWorkflowStore()
  const {
    appId,
    nodesWithInspectVars,
    setNodeInspectVars,
    setInspectVarValue,
    renameInspectVarName: renameInspectVarNameInStore,
    deleteAllInspectVars: deleteAllInspectVarsInStore,
    hasNodeInspectVars,
    deleteNodeInspectVars: deleteNodeInspectVarsInStore,
    deleteInspectVar: deleteInspectVarInStore,
    isInspectVarEdited,
  } = workflowStore.getState()

  const { data: conversationVars } = useConversationVarValues(appId)
  const invalidateConversationVarValues = useInvalidateConversationVarValues(appId)
  const { data: systemVars } = useSysVarValues(appId)
  const invalidateSysVarValues = useInvalidateSysVarValues(appId)

  const { mutate: doDeleteAllInspectorVars } = useDeleteAllInspectorVars(appId)
  const { mutate: doDeleteNodeInspectorVars } = useDeleteNodeInspectorVars(appId)
  const { mutate: doDeleteInspectVar } = useDeleteInspectVar(appId)

  const { mutate: doEditInspectorVar } = useEditInspectorVar(appId)

  const fetchInspectVarValue = async (selector: ValueSelector) => {
    const nodeId = selector[0]
    const isSystemVar = selector[1] === 'sys'
    const isConversationVar = selector[1] === 'conversation'
    console.log(nodeId, isSystemVar, isConversationVar)
    if (isSystemVar) {
      invalidateSysVarValues()
      return
    }
    if (isConversationVar) {
      invalidateConversationVarValues()
      return
    }
    const vars = await fetchNodeInspectVars(appId, nodeId)
    setNodeInspectVars(nodeId, vars)
  }

  const deleteInspectVar = async (nodeId: string, varId: string) => {
    await doDeleteInspectVar(varId)
    deleteInspectVarInStore(nodeId, varId)
  }

  const deleteNodeInspectorVars = async (nodeId: string) => {
    if (hasNodeInspectVars(nodeId))
      await doDeleteNodeInspectorVars(nodeId)

    deleteNodeInspectVarsInStore(nodeId)
  }

  const deleteAllInspectorVars = async () => {
    await doDeleteAllInspectorVars()
    await invalidateConversationVarValues()
    await invalidateSysVarValues()
    deleteAllInspectVarsInStore()
  }

  const editInspectVarValue = async (nodeId: string, varId: string, value: any) => {
    await doEditInspectorVar({
      nodeId,
      varId,
      value,
    })
    setInspectVarValue(nodeId, varId, value)
  }

  const renameInspectVarName = async (nodeId: string, varId: string, selector: ValueSelector) => {
    await doEditInspectorVar({
      nodeId,
      varId,
      name: selector[1],
    })
    renameInspectVarNameInStore(nodeId, varId, selector)
  }

  const editInspectVarValueType = (nodeId: string) => {
    deleteNodeInspectorVars(nodeId)
  }

  const resetToLastRunVar = (nodeId: string, key: string) => {
    // const lastRunVar = getLastRunVar(nodeId, key)
    // if (lastRunVar)
    //   editInspectVarValue(nodeId, key, lastRunVar)
    // TODO
  }

  // console.log(conversationVars, systemVars)

  return {
    conversationVars: conversationVars || [],
    systemVars: systemVars || [],
    nodesWithInspectVars,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    editInspectVarValueType,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
  }
}

export default useInspectVarsCrud
