import { VarType } from '@/app/components/workflow/types'

export const HTTP_BODY_VARIABLE_TYPES: VarType[] = [
  VarType.string,
  VarType.number,
  VarType.secret,
  VarType.object,
  VarType.arrayNumber,
  VarType.arrayString,
  VarType.arrayObject,
]

export const isSupportedHttpBodyVariable = (type: VarType) => {
  return HTTP_BODY_VARIABLE_TYPES.includes(type)
}
