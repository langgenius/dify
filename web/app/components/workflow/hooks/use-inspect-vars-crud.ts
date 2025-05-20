import { fetchNodeInspectVars } from '@/service/workflow'
import { useStore, useWorkflowStore } from '../store'
import type { ValueSelector } from '../types'
import type { VarInInspect } from '@/types/workflow'
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
import { isConversationVar, isENV, isSystemVar } from '../nodes/_base/components/variable/utils'
import produce from 'immer'
import type { Node } from '@/app/components/workflow/types'
import { useNodesInteractionsWithoutSync } from './use-nodes-interactions-without-sync'

const useInspectVarsCrud = () => {
  const workflowStore = useWorkflowStore()
  const nodesWithInspectVars = useStore(s => s.nodesWithInspectVars)
  const {
    appId,
    setNodeInspectVars,
    setInspectVarValue,
    renameInspectVarName: renameInspectVarNameInStore,
    deleteAllInspectVars: deleteAllInspectVarsInStore,
    deleteNodeInspectVars: deleteNodeInspectVarsInStore,
    deleteInspectVar: deleteInspectVarInStore,
    setNodesWithInspectVars,
  } = workflowStore.getState()

  const { data: conversationVars } = useConversationVarValues(appId)
  const invalidateConversationVarValues = useInvalidateConversationVarValues(appId)
  const { data: systemVars } = useSysVarValues(appId)
  const invalidateSysVarValues = useInvalidateSysVarValues(appId)

  const { mutate: doDeleteAllInspectorVars } = useDeleteAllInspectorVars(appId)
  const { mutate: doDeleteNodeInspectorVars } = useDeleteNodeInspectorVars(appId)
  const { mutate: doDeleteInspectVar } = useDeleteInspectVar(appId)

  const { mutate: doEditInspectorVar } = useEditInspectorVar(appId)
  const { handleCancelNodeSuccessStatus } = useNodesInteractionsWithoutSync()

  const getNodeInspectVars = useCallback((nodeId: string) => {
    const node = nodesWithInspectVars.find(node => node.nodeId === nodeId)
    return node
  }, [nodesWithInspectVars])

  const getVarId = useCallback((nodeId: string, varName: string) => {
    const node = getNodeInspectVars(nodeId)
    if (!node)
      return undefined
    const varId = node.vars.find((varItem) => {
        return varItem.selector[1] === varName
      })?.id
      return varId
  }, [getNodeInspectVars])

  const getInspectVar = useCallback((nodeId: string, name: string) => {
    const node = getNodeInspectVars(nodeId)
      if (!node)
        return undefined

      const variable = node.vars.find((varItem) => {
        return varItem.selector[1] === name
      })?.value
      return variable
  }, [getNodeInspectVars])

  const hasSetInspectVar = useCallback((nodeId: string, name: string, sysVars: VarInInspect[], conversationVars: VarInInspect[]) => {
      const isEnv = isENV([nodeId])
      if (isEnv) // always have value
        return true
      const isSys = isSystemVar([nodeId])
      if (isSys)
        return sysVars.some(varItem => varItem.selector?.[1] === name)
      const isChatVar = isConversationVar([nodeId])
      if (isChatVar)
        return conversationVars.some(varItem => varItem.selector?.[1] === name)
      return getInspectVar(nodeId, name) !== undefined
  }, [getInspectVar])

  const hasNodeInspectVars = useCallback((nodeId: string) => {
    return !!getNodeInspectVars(nodeId)
  }, [getNodeInspectVars])

  const fetchInspectVarValue = async (selector: ValueSelector) => {
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
    const vars = await fetchNodeInspectVars(appId, nodeId)
    setNodeInspectVars(nodeId, vars)
  }

  // after last run would call this
  const appendNodeInspectVars = (nodeId: string, payload: VarInInspect[], allNodes: Node[]) => {
    const nodes = produce(nodesWithInspectVars, (draft) => {
      const nodeInfo = allNodes.find(node => node.id === nodeId)
        if (nodeInfo) {
          const index = draft.findIndex(node => node.nodeId === nodeId)
          if (index === -1) {
            draft.push({
              nodeId,
              nodeType: nodeInfo.data.type,
              title: nodeInfo.data.title,
              vars: payload,
            })
          }
          else {
            draft[index].vars = payload
          }
        }
    })
    setNodesWithInspectVars(nodes)
    handleCancelNodeSuccessStatus(nodeId)
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
    if (nodeId === VarInInspectType.conversation) {
      invalidateConversationVarValues()
    }
    else if (nodeId === VarInInspectType.system) {
      invalidateSysVarValues()
    }
    else {
      await doEditInspectorVar({
        varId,
        value,
      })
      setInspectVarValue(nodeId, varId, value)
    }
  }, [doEditInspectorVar, invalidateConversationVarValues, invalidateSysVarValues, setInspectVarValue])

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

  const isInspectVarEdited = useCallback((nodeId: string, name: string) => {
    const inspectVar = getInspectVar(nodeId, name)
      if (!inspectVar)
        return false

      return inspectVar.edited
  }, [getInspectVar])

  const resetToLastRunVar = (nodeId: string, varId: string) => {
    setCurrNodeId(nodeId)
    setCurrEditVarId(varId)
  }

  return {
    conversationVars: conversationVars || [],
    systemVars: systemVars || [],
    nodesWithInspectVars,
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
  }
}

export default useInspectVarsCrud
