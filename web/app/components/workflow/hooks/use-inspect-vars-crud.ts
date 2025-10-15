import { useStore } from '../store'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import {
  useConversationVarValues,
  useSysVarValues,
} from '@/service/use-workflow'
import { FlowType } from '@/types/common'

const useInspectVarsCrud = () => {
  const nodesWithInspectVars = useStore(s => s.nodesWithInspectVars)
  const configsMap = useHooksStore(s => s.configsMap)
  const isRagPipeline = configsMap?.flowType === FlowType.ragPipeline
  const { data: conversationVars } = useConversationVarValues(configsMap?.flowType, !isRagPipeline ? configsMap?.flowId : '')
  const { data: systemVars } = useSysVarValues(configsMap?.flowType, !isRagPipeline ? configsMap?.flowId : '')
  const hasNodeInspectVars = useHooksStore(s => s.hasNodeInspectVars)
  const hasSetInspectVar = useHooksStore(s => s.hasSetInspectVar)
  const fetchInspectVarValue = useHooksStore(s => s.fetchInspectVarValue)
  const editInspectVarValue = useHooksStore(s => s.editInspectVarValue)
  const renameInspectVarName = useHooksStore(s => s.renameInspectVarName)
  const appendNodeInspectVars = useHooksStore(s => s.appendNodeInspectVars)
  const deleteInspectVar = useHooksStore(s => s.deleteInspectVar)
  const deleteNodeInspectorVars = useHooksStore(s => s.deleteNodeInspectorVars)
  const deleteAllInspectorVars = useHooksStore(s => s.deleteAllInspectorVars)
  const isInspectVarEdited = useHooksStore(s => s.isInspectVarEdited)
  const resetToLastRunVar = useHooksStore(s => s.resetToLastRunVar)
  const invalidateSysVarValues = useHooksStore(s => s.invalidateSysVarValues)
  const resetConversationVar = useHooksStore(s => s.resetConversationVar)
  const invalidateConversationVarValues = useHooksStore(s => s.invalidateConversationVarValues)

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
