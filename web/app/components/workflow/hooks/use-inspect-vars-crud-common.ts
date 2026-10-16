import type { Node, ValueSelector } from '@/app/components/workflow/types'
import type { SchemaTypeDefinition } from '@/service/use-common'
import type { VarInInspect } from '@/types/workflow'
import { useQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import {
  isConversationVar,
  isENV,
  isSystemVar,
  toNodeOutputVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import {
  useDeleteAllInspectorVars,
  useDeleteInspectVar,
  useDeleteNodeInspectorVars,
  useEditInspectorVar,
  useInvalidateConversationVarValues,
  useInvalidateSysVarValues,
  useResetInspectorVar,
} from '@/service/use-workflow'
import { fetchNodeInspectVars } from '@/service/workflow'
import { VarInInspectType } from '@/types/workflow'
import { useEdgesInteractionsWithoutSync } from './use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from './use-nodes-interactions-without-sync'

export const useInspectVarsCrudCommon = () => {
  const resource = useAtomValue(editorResourceAtom)
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()
  const invalidateConversationVarValues = useInvalidateConversationVarValues(resource)
  const { mutateAsync: doResetInspectorVar } = useResetInspectorVar(resource)
  const invalidateSysVarValues = useInvalidateSysVarValues(resource)

  const { mutateAsync: doDeleteAllInspectorVars } = useDeleteAllInspectorVars(resource)
  const { mutateAsync: doDeleteNodeInspectorVars } = useDeleteNodeInspectorVars(resource)
  const { mutateAsync: doDeleteInspectVar } = useDeleteInspectVar(resource)

  const { mutateAsync: doEditInspectorVar } = useEditInspectorVar(resource)
  const { handleCancelNodeSuccessStatus } = useNodesInteractionsWithoutSync()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync()
  const { data: buildInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: mcpTools } = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({ select: selectToolsWithProvider }),
  )

  const getNodeInspectVars = useCallback(
    (nodeId: string) => {
      const { nodesWithInspectVars } = workflowStore.getState()
      const node = nodesWithInspectVars.find((node) => node.nodeId === nodeId)
      return node
    },
    [workflowStore],
  )

  const getVarId = useCallback(
    (nodeId: string, varName: string) => {
      const node = getNodeInspectVars(nodeId)
      if (!node) return undefined
      const varId = node.vars.find((varItem) => {
        return varItem.selector[1] === varName
      })?.id
      return varId
    },
    [getNodeInspectVars],
  )

  const getInspectVar = useCallback(
    (nodeId: string, name: string): VarInInspect | undefined => {
      const node = getNodeInspectVars(nodeId)
      if (!node) return undefined

      const variable = node.vars.find((varItem) => {
        return varItem.name === name
      })
      return variable
    },
    [getNodeInspectVars],
  )

  const hasSetInspectVar = useCallback(
    (nodeId: string, name: string, sysVars: VarInInspect[], conversationVars: VarInInspect[]) => {
      const isEnv = isENV([nodeId])
      if (isEnv)
        // always have value
        return true
      const isSys = isSystemVar([nodeId])
      if (isSys)
        return sysVars.some((varItem) => varItem.selector?.[1]?.replace('sys.', '') === name)
      const isChatVar = isConversationVar([nodeId])
      if (isChatVar) return conversationVars.some((varItem) => varItem.selector?.[1] === name)
      return getInspectVar(nodeId, name) !== undefined
    },
    [getInspectVar],
  )

  const hasNodeInspectVars = useCallback(
    (nodeId: string) => {
      return !!getNodeInspectVars(nodeId)
    },
    [getNodeInspectVars],
  )

  const fetchInspectVarValue = useCallback(
    async (selector: ValueSelector, schemaTypeDefinitions: SchemaTypeDefinition[]) => {
      const { setNodeInspectVars, dataSourceList } = workflowStore.getState()
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
      const currentNode = nodeArr.find((node) => node.id === nodeId)
      const allPluginInfoList = {
        buildInTools: buildInTools || [],
        customTools: customTools || [],
        workflowTools: workflowTools || [],
        mcpTools: mcpTools || [],
        dataSourceList: dataSourceList || [],
      }
      const currentNodeOutputVars = toNodeOutputVars(
        [currentNode],
        false,
        () => true,
        [],
        [],
        [],
        allPluginInfoList,
        schemaTypeDefinitions,
      )
      const vars = await fetchNodeInspectVars(resource, nodeId!)
      const varsWithSchemaType = vars.map((varItem) => {
        const schemaType =
          currentNodeOutputVars[0]?.vars.find((v) => v.variable === varItem.name)?.schemaType || ''
        return {
          ...varItem,
          schemaType,
        }
      })
      setNodeInspectVars(nodeId!, varsWithSchemaType)
    },
    [
      workflowStore,
      resource,
      invalidateSysVarValues,
      invalidateConversationVarValues,
      buildInTools,
      customTools,
      workflowTools,
      mcpTools,
    ],
  )

  // after last run would call this
  const appendNodeInspectVars = useCallback(
    (nodeId: string, payload: VarInInspect[], allNodes: Node[]) => {
      const { nodesWithInspectVars, setNodesWithInspectVars } = workflowStore.getState()
      const nodes = produce(nodesWithInspectVars, (draft) => {
        const nodeInfo = allNodes.find((node) => node.id === nodeId)
        if (nodeInfo) {
          const index = draft.findIndex((node) => node.nodeId === nodeId)
          if (index === -1) {
            draft.unshift({
              nodeId,
              nodeType: nodeInfo.data.type,
              title: nodeInfo.data.title,
              vars: payload,
              nodePayload: nodeInfo.data,
            })
          } else {
            draft[index]!.vars = payload
            // put the node to the topAdd commentMore actions
            draft.unshift(draft.splice(index, 1)[0]!)
          }
        }
      })
      setNodesWithInspectVars(nodes)
      handleCancelNodeSuccessStatus(nodeId)
    },
    [workflowStore, handleCancelNodeSuccessStatus],
  )

  const hasNodeInspectVar = useCallback(
    (nodeId: string, varId: string) => {
      const { nodesWithInspectVars } = workflowStore.getState()
      const targetNode = nodesWithInspectVars.find((item) => item.nodeId === nodeId)
      if (!targetNode || !targetNode.vars) return false
      return targetNode.vars.some((item) => item.id === varId)
    },
    [workflowStore],
  )

  const deleteInspectVar = useCallback(
    async (nodeId: string, varId: string) => {
      const { deleteInspectVar } = workflowStore.getState()
      if (hasNodeInspectVar(nodeId, varId)) {
        try {
          await doDeleteInspectVar(varId)
        } catch {
          // The Console transport reports the failure; preserve the inspected values.
          return
        }
        deleteInspectVar(nodeId, varId)
      }
    },
    [doDeleteInspectVar, workflowStore, hasNodeInspectVar],
  )

  const resetConversationVar = useCallback(
    async (varId: string) => {
      await doResetInspectorVar(varId)
      invalidateConversationVarValues()
    },
    [doResetInspectorVar, invalidateConversationVarValues],
  )

  const deleteNodeInspectorVars = useCallback(
    async (nodeId: string) => {
      const { deleteNodeInspectVars } = workflowStore.getState()
      if (hasNodeInspectVars(nodeId)) {
        try {
          await doDeleteNodeInspectorVars(nodeId)
        } catch {
          // The Console transport reports the failure; preserve the inspected values.
          return
        }
        deleteNodeInspectVars(nodeId)
      }
    },
    [doDeleteNodeInspectorVars, workflowStore, hasNodeInspectVars],
  )

  const deleteAllInspectorVars = useCallback(async () => {
    const { deleteAllInspectVars } = workflowStore.getState()
    await doDeleteAllInspectorVars()
    await invalidateConversationVarValues()
    await invalidateSysVarValues()
    deleteAllInspectVars()
    handleEdgeCancelRunningStatus()
  }, [
    doDeleteAllInspectorVars,
    invalidateConversationVarValues,
    invalidateSysVarValues,
    workflowStore,
    handleEdgeCancelRunningStatus,
  ])

  const editInspectVarValue = useCallback(
    async (nodeId: string, varId: string, value: VarInInspect['value']) => {
      const { setInspectVarValue } = workflowStore.getState()
      await doEditInspectorVar({
        varId,
        value,
      })
      setInspectVarValue(nodeId, varId, value)
      if (nodeId === VarInInspectType.conversation) invalidateConversationVarValues()
      if (nodeId === VarInInspectType.system) invalidateSysVarValues()
    },
    [doEditInspectorVar, invalidateConversationVarValues, invalidateSysVarValues, workflowStore],
  )

  const renameInspectVarName = useCallback(
    async (nodeId: string, oldName: string, newName: string) => {
      const { renameInspectVarName } = workflowStore.getState()
      const varId = getVarId(nodeId, oldName)
      if (!varId) return

      const newSelector = [nodeId, newName]
      await doEditInspectorVar({
        varId,
        name: newName,
      })
      renameInspectVarName(nodeId, varId, newSelector)
    },
    [doEditInspectorVar, getVarId, workflowStore],
  )

  const isInspectVarEdited = useCallback(
    (nodeId: string, name: string) => {
      const inspectVar = getInspectVar(nodeId, name)
      if (!inspectVar) return false

      return inspectVar.edited
    },
    [getInspectVar],
  )

  const resetToLastRunVar = useCallback(
    async (nodeId: string, varId: string) => {
      const { resetToLastRunVar } = workflowStore.getState()
      const isSysVar = nodeId === 'sys'
      const data = await doResetInspectorVar(varId)

      if (isSysVar) invalidateSysVarValues()
      else if (data && typeof data === 'object' && 'value' in data)
        resetToLastRunVar(nodeId, varId, data.value)
      else workflowStore.getState().deleteInspectVar(nodeId, varId)
    },
    [doResetInspectorVar, invalidateSysVarValues, workflowStore],
  )

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
