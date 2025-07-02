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
  useResetConversationVar,
  useResetToLastRunValue,
  useSysVarValues,
} from '@/service/use-workflow'
import { useCallback } from 'react'
import { isConversationVar, isENV, isSystemVar } from '../nodes/_base/components/variable/utils'
import produce from 'immer'
import type { Node } from '@/app/components/workflow/types'
import { useNodesInteractionsWithoutSync } from './use-nodes-interactions-without-sync'
import { useEdgesInteractionsWithoutSync } from './use-edges-interactions-without-sync'

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
    resetToLastRunVar: resetToLastRunVarInStore,
  } = workflowStore.getState()

  const { data: conversationVars } = useConversationVarValues(appId)
  const invalidateConversationVarValues = useInvalidateConversationVarValues(appId)
  const { mutateAsync: doResetConversationVar } = useResetConversationVar(appId)
  const { mutateAsync: doResetToLastRunValue } = useResetToLastRunValue(appId)
  const { data: systemVars } = useSysVarValues(appId)
  const invalidateSysVarValues = useInvalidateSysVarValues(appId)

  const { mutateAsync: doDeleteAllInspectorVars } = useDeleteAllInspectorVars(appId)
  const { mutate: doDeleteNodeInspectorVars } = useDeleteNodeInspectorVars(appId)
  const { mutate: doDeleteInspectVar } = useDeleteInspectVar(appId)

  const { mutateAsync: doEditInspectorVar } = useEditInspectorVar(appId)
  const { handleCancelNodeSuccessStatus } = useNodesInteractionsWithoutSync()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync()
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
              nodePayload: nodeInfo.data,
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

  const hasNodeInspectVar = (nodeId: string, varId: string) => {
    const targetNode = nodesWithInspectVars.find(item => item.nodeId === nodeId)
    if(!targetNode || !targetNode.vars)
      return false
    return targetNode.vars.some(item => item.id === varId)
  }

  const deleteInspectVar = async (nodeId: string, varId: string) => {
    if(hasNodeInspectVar(nodeId, varId)) {
      await doDeleteInspectVar(varId)
      deleteInspectVarInStore(nodeId, varId)
    }
  }

  const resetConversationVar = async (varId: string) => {
    await doResetConversationVar(varId)
    invalidateConversationVarValues()
  }

  const deleteNodeInspectorVars = async (nodeId: string) => {
    if (hasNodeInspectVars(nodeId)) {
      await doDeleteNodeInspectorVars(nodeId)
      deleteNodeInspectVarsInStore(nodeId)
    }
  }

  const deleteAllInspectorVars = async () => {
    await doDeleteAllInspectorVars()
    await invalidateConversationVarValues()
    await invalidateSysVarValues()
    deleteAllInspectVarsInStore()
    handleEdgeCancelRunningStatus()
  }

  const editInspectVarValue = useCallback(async (nodeId: string, varId: string, value: any) => {
    await doEditInspectorVar({
      varId,
      value,
    })
    setInspectVarValue(nodeId, varId, value)
    if (nodeId === VarInInspectType.conversation)
      invalidateConversationVarValues()
    if (nodeId === VarInInspectType.system)
      invalidateSysVarValues()
  }, [doEditInspectorVar, invalidateConversationVarValues, invalidateSysVarValues, setInspectVarValue])

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

  const resetToLastRunVar = async (nodeId: string, varId: string) => {
    const isSysVar = nodeId === 'sys'
    const data = await doResetToLastRunValue(varId)

    if(isSysVar)
      invalidateSysVarValues()
    else
      resetToLastRunVarInStore(nodeId, varId, data.value)
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
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
  }
}

export default useInspectVarsCrud
