import type { FlowType } from '@/types/common'
import { curry } from 'es-toolkit/compat'
import {
  useDeleteAllInspectorVars as useDeleteAllInspectorVarsInner,
  useDeleteInspectVar as useDeleteInspectVarInner,
  useDeleteNodeInspectorVars as useDeleteNodeInspectorVarsInner,
  useEditInspectorVar as useEditInspectorVarInner,
  useInvalidateConversationVarValues as useInvalidateConversationVarValuesInner,
  useInvalidateSysVarValues as useInvalidateSysVarValuesInner,
  useResetConversationVar as useResetConversationVarInner,
  useResetToLastRunValue as useResetToLastRunValueInner,
} from './use-workflow'

type Params = {
  flowType: FlowType
}

const useFLow = ({
  flowType,
}: Params) => {
  return {
    useInvalidateConversationVarValues: curry(useInvalidateConversationVarValuesInner)(flowType),
    useInvalidateSysVarValues: curry(useInvalidateSysVarValuesInner)(flowType),
    useResetConversationVar: curry(useResetConversationVarInner)(flowType),
    useResetToLastRunValue: curry(useResetToLastRunValueInner)(flowType),
    useDeleteAllInspectorVars: curry(useDeleteAllInspectorVarsInner)(flowType),
    useDeleteNodeInspectorVars: curry(useDeleteNodeInspectorVarsInner)(flowType),
    useDeleteInspectVar: curry(useDeleteInspectVarInner)(flowType),
    useEditInspectorVar: curry(useEditInspectorVarInner)(flowType),
  }
}

export default useFLow
