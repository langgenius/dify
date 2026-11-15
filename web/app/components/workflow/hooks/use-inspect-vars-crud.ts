import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useConversationVarValues, useSysVarValues } from '@/service/use-workflow'
import { useStore } from '../store'
import { BlockEnum } from '../types'

const varsAppendStartNodeKeys = ['query', 'files']
const useInspectVarsCrud = () => {
  const partOfNodesWithInspectVars = useStore((s) => s.nodesWithInspectVars)
  const resource = useAtomValue(editorResourceAtom)
  const appResource = resource.kind === 'app' ? resource : undefined
  const { data: conversationVars } = useConversationVarValues(appResource)
  const { data: allSystemVars } = useSysVarValues(appResource)
  const { varsAppendStartNode, systemVars } = (() => {
    if (allSystemVars?.length === 0) return { varsAppendStartNode: [], systemVars: [] }
    const varsAppendStartNode =
      allSystemVars?.filter(({ name }) => varsAppendStartNodeKeys.includes(name)) || []
    const systemVars =
      allSystemVars?.filter(({ name }) => !varsAppendStartNodeKeys.includes(name)) || []
    return { varsAppendStartNode, systemVars }
  })()
  const nodesWithInspectVars = (() => {
    if (!partOfNodesWithInspectVars || partOfNodesWithInspectVars.length === 0) return []

    const nodesWithInspectVars = produce(partOfNodesWithInspectVars, (draft) => {
      draft.forEach((nodeWithVars) => {
        if (nodeWithVars.nodeType === BlockEnum.Start)
          nodeWithVars.vars = [...nodeWithVars.vars, ...varsAppendStartNode]
      })
    })
    return nodesWithInspectVars
  })()
  const hasNodeInspectVars = useHooksStore((s) => s.hasNodeInspectVars)
  const hasSetInspectVar = useHooksStore((s) => s.hasSetInspectVar)
  const fetchInspectVarValue = useHooksStore((s) => s.fetchInspectVarValue)
  const editInspectVarValue = useHooksStore((s) => s.editInspectVarValue)
  const renameInspectVarName = useHooksStore((s) => s.renameInspectVarName)
  const appendNodeInspectVars = useHooksStore((s) => s.appendNodeInspectVars)
  const deleteInspectVar = useHooksStore((s) => s.deleteInspectVar)
  const deleteNodeInspectorVars = useHooksStore((s) => s.deleteNodeInspectorVars)
  const deleteAllInspectorVars = useHooksStore((s) => s.deleteAllInspectorVars)
  const isInspectVarEdited = useHooksStore((s) => s.isInspectVarEdited)
  const resetToLastRunVar = useHooksStore((s) => s.resetToLastRunVar)
  const invalidateSysVarValues = useHooksStore((s) => s.invalidateSysVarValues)
  const resetConversationVar = useHooksStore((s) => s.resetConversationVar)
  const invalidateConversationVarValues = useHooksStore((s) => s.invalidateConversationVarValues)

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
