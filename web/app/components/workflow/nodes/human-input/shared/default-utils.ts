import type { TFunction } from 'i18next'
import type { FormInputItem, HumanInputSharedConfig } from './types'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

const getFormInputVarType = (input: FormInputItem): VarType => {
  if (input.type === 'file') return VarType.file
  if (input.type === 'file-list') return VarType.arrayFile
  return VarType.string
}

export const buildHumanInputOutputVars = (inputs: FormInputItem[]): Var[] =>
  inputs.map((input) => ({
    variable: input.output_variable_name,
    type: getFormInputVarType(input),
  }))

export const getHumanInputSharedValidationError = (
  payload: Pick<HumanInputSharedConfig, 'user_actions'>,
  t: TFunction<'workflow'>,
): string => {
  if (!payload.user_actions.length)
    return t(($) => $['nodes.humanInput.errorMsg.noUserActions'], { ns: 'workflow' })
  if (new Set(payload.user_actions.map((action) => action.id)).size !== payload.user_actions.length)
    return t(($) => $['nodes.humanInput.errorMsg.duplicateActionId'], { ns: 'workflow' })
  if (payload.user_actions.some((action) => !action.id.trim()))
    return t(($) => $['nodes.humanInput.errorMsg.emptyActionId'], { ns: 'workflow' })
  if (payload.user_actions.some((action) => !action.title.trim()))
    return t(($) => $['nodes.humanInput.errorMsg.emptyActionTitle'], { ns: 'workflow' })
  return ''
}
