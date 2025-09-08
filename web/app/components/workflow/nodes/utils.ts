import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'

export const findVariableWhenOnLLMVision = (valueSelector: ValueSelector, availableVars: NodeOutPutVar[]) => {
  const currentVariableNode = availableVars.find((availableVar) => {
    if (valueSelector[0] === 'sys' && availableVar.isStartNode)
      return true

    return valueSelector[0] === availableVar.nodeId
  })
  const currentVariable = currentVariableNode?.vars.find((variable) => {
    if (valueSelector[0] === 'sys' && variable.variable === `sys.${valueSelector[1]}`)
      return true
    return variable.variable === valueSelector[1]
  })

  let formType = ''
  if (currentVariable?.type === 'array[file]')
    formType = InputVarType.multiFiles
  if (currentVariable?.type === 'file')
    formType = InputVarType.singleFile

  return currentVariable && {
    ...currentVariable,
    formType,
  }
}

export const getConditionValueAsString = (condition: { value: any }) => {
  if (Array.isArray(condition.value))
    return condition.value[0] ?? ''

  if (typeof condition.value === 'number')
    return String(condition.value)

  return condition.value ?? ''
}
