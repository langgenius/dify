import { InputVarType } from '@/app/components/workflow/types'

export const isInputValueEmpty = (type: InputVarType, value: unknown) => {
  if (type === InputVarType.multiSelect) return !Array.isArray(value) || value.length === 0

  return !value
}
