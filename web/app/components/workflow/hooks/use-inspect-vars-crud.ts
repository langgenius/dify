import { fetchNodeInspectVars } from '@/service/workflow'
import { useWorkflowStore } from '../store'
import type { ValueSelector } from '../types'
import { VarInInspectType } from '@/types/workflow'
import {
  useConversationVarValues,
  useDeleteAllInspectorVars,
  useDeleteInspectVar,
  useDeleteNodeInspectorVars,
  useEditInspectorVar,
  useInvalidateConversationVarValues,
  useInvalidateSysVarValues,
  useLastRun,
  useSysVarValues,
} from '@/service/use-workflow'
import { useCallback, useEffect, useState } from 'react'

const useInspectVarsCrud = () => {
  const workflowStore = useWorkflowStore()
  const {
    appId,
    nodesWithInspectVars,
    getNodeInspectVars,
    setNodeInspectVars,
    setInspectVarValue,
    getVarId,
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

  const editInspectVarValue = useCallback(async (nodeId: string, varId: string, value: any) => {
    await doEditInspectorVar({
      varId,
      value,
    })
    if (nodeId !== VarInInspectType.conversation && nodeId !== VarInInspectType.system)
      setInspectVarValue(nodeId, varId, value)
  }, [doEditInspectorVar, setInspectVarValue])

  const [currNodeId, setCurrNodeId] = useState<string | null>(null)
  const [currEditVarId, setCurrEditVarId] = useState<string | null>(null)
  const { data } = useLastRun(appId, currNodeId || '', !!currNodeId)
  useEffect(() => {
    if (data && currNodeId && currEditVarId) {
      const inspectVar = getNodeInspectVars(currNodeId)?.vars?.find(item => item.id === currEditVarId);
      (async () => {
        await editInspectVarValue(currNodeId, currEditVarId, data.outputs?.[inspectVar?.selector?.[1] || ''])
        setCurrNodeId(null)
      })()
    }
  }, [data, currNodeId, currEditVarId, getNodeInspectVars, editInspectVarValue])

  const renameInspectVarName = async (nodeId: string, oldName: string, newName: string) => {
    const varId = getVarId(nodeId, oldName)
    if (!varId)
      return

    const newSelector = [nodeId, newName]
    await doEditInspectorVar({
      varId,
      name: newName,
    })
    renameInspectVarNameInStore(nodeId, varId, newSelector)
  }

  const editInspectVarValueType = async (nodeId: string) => {
    return await deleteNodeInspectorVars(nodeId)
  }

  const resetToLastRunVar = (nodeId: string, varId: string) => {
    setCurrNodeId(nodeId)
    setCurrEditVarId(varId)
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
