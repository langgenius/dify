import { isTextVarType } from '@/app/components/workflow/nodes/_base/components/variable/text-var-types'
import { VarType } from '@/app/components/workflow/types'

// Structured values a JSON body can carry; text values are covered by isTextVarType.
const HTTP_BODY_STRUCTURED_VARIABLE_TYPES: VarType[] = [
  VarType.object,
  VarType.arrayNumber,
  VarType.arrayString,
  VarType.arrayObject,
]

export const isSupportedHttpBodyVariable = (type: VarType) => {
  return isTextVarType(type) || HTTP_BODY_STRUCTURED_VARIABLE_TYPES.includes(type)
}
