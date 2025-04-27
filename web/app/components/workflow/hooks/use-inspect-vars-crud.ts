import { useWorkflowStore } from '../store'
import type { ValueSelector, VarType } from '../types'
import {
  useConversationVarValues,
  useDeleteAllInspectorVars,
  useDeleteInspectVar,
  useDeleteNodeInspectorVars,
  useInvalidateConversationVarValues,
  useInvalidateSysVarValues,
  useSysVarValues,
} from '@/service/use-workflow'

const useInspectVarsCrud = () => {
  const workflowStore = useWorkflowStore()
  const {
    appId,
    nodesWithInspectVars,
    getInspectVar,
    setInspectVar,
    deleteAllInspectVars: deleteAllInspectVarsInStore,
    deleteNodeInspectVars: deleteNodeInspectVarsInStore,
    deleteInspectVar: deleteInspectVarInStore,
    getLastRunVar,
  } = workflowStore.getState()

  const { data: conversationVars } = useConversationVarValues(appId)
  const invalidateConversationVarValues = useInvalidateConversationVarValues(appId)
  const { data: systemVars } = useSysVarValues(appId)
  const invalidateSysVarValues = useInvalidateSysVarValues(appId)

  const { mutate: doDeleteAllInspectorVars } = useDeleteAllInspectorVars(appId)
  const { mutate: doDeleteNodeInspectorVars } = useDeleteNodeInspectorVars(appId)
  const { mutate: doDeleteInspectVar } = useDeleteInspectVar(appId)

  const fetchInspectVarValue = (selector: ValueSelector) => {
    const nodeId = selector[0]
    const isSystemVar = selector[1] === 'sys'
    const isConversationVar = selector[1] === 'conversation'
    console.log(nodeId, isSystemVar, isConversationVar)
    // fetch values under nodeId. system var and conversation var has different fetch method
  }

  const editInspectVarValue = (varId: string, value: any) => {
    console.log('edit var', varId, value)

    // call api and update store
  }

  const editInspectVarSelector = (varId: string, selector: ValueSelector) => {
    console.log('edit var selector', varId, selector)
    // call api and update store
  }

  const editInspectVarValueType = (varId: string, valueType: VarType) => {
    console.log('edit var value type', varId, valueType)
  }

  const deleteInspectVar = async (nodeId: string, varId: string) => {
    await doDeleteInspectVar(varId)
    deleteInspectVarInStore(nodeId, varId)
  }

  const deleteNodeInspectorVars = async (nodeId: string) => {
    await doDeleteNodeInspectorVars(nodeId)
    deleteNodeInspectVarsInStore(nodeId)
  }

  const deleteAllInspectorVars = async () => {
    await doDeleteAllInspectorVars()
    await invalidateConversationVarValues()
    await invalidateSysVarValues()
    deleteAllInspectVarsInStore()
  }

  const isInspectVarEdited = (nodeId: string, key: string) => {
    return getInspectVar(nodeId, key) !== getLastRunVar(nodeId, key)
  }

  const resetToLastRunVar = (nodeId: string, key: string) => {
    const lastRunVar = getLastRunVar(nodeId, key)
    if (lastRunVar)
      setInspectVar(nodeId, key, lastRunVar)
  }

  console.log(conversationVars, systemVars)

  return {
    conversationVars: conversationVars || [],
    systemVars: systemVars || [],
    nodesWithInspectVars,
    fetchInspectVarValue,
    editInspectVarValue,
    editInspectVarSelector,
    editInspectVarValueType,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
  }
}

export default useInspectVarsCrud
