import type { InputVar, Node, ValueSelector, Variable } from '../../types'
import type { CaseItem, Condition, LoopVariable } from './types'
import { ValueType } from '@/app/components/workflow/types'
import { VALUE_SELECTOR_DELIMITER as DELIMITER } from '@/config'
import { getNodeInfoById, getNodeUsedVarPassToServerKey, getNodeUsedVars, isSystemVar } from '../_base/components/variable/utils'

export function getVarSelectorsFromCase(caseItem: CaseItem): ValueSelector[] {
  const vars: ValueSelector[] = []
  caseItem.conditions?.forEach((condition) => {
    vars.push(...getVarSelectorsFromCondition(condition))
  })
  return vars
}

export function getVarSelectorsFromCondition(condition: Condition): ValueSelector[] {
  const vars: ValueSelector[] = []
  if (condition.variable_selector)
    vars.push(condition.variable_selector)

  if (condition.sub_variable_condition?.conditions?.length)
    vars.push(...getVarSelectorsFromCase(condition.sub_variable_condition))

  return vars
}

export const createInputVarValues = (runInputData: Record<string, unknown>) => {
  const vars: Record<string, unknown> = {}
  Object.keys(runInputData).forEach((key) => {
    vars[key] = runInputData[key]
  })
  return vars
}

export const dedupeInputVars = (inputVars: InputVar[]) => {
  const seen: Record<string, boolean> = {}
  const uniqueInputVars: InputVar[] = []

  inputVars.forEach((input) => {
    if (!input || seen[input.variable])
      return

    seen[input.variable] = true
    uniqueInputVars.push(input)
  })

  return uniqueInputVars
}

export const buildUsedOutVars = ({
  loopChildrenNodes,
  currentNodeId,
  canChooseVarNodes,
  isNodeInLoop,
  toVarInputs,
}: {
  loopChildrenNodes: Node[]
  currentNodeId: string
  canChooseVarNodes: Node[]
  isNodeInLoop: (nodeId: string) => boolean
  toVarInputs: (variables: Variable[]) => InputVar[]
}) => {
  const vars: ValueSelector[] = []
  const seenVarSelectors: Record<string, boolean> = {}
  const allVarObject: Record<string, { inSingleRunPassedKey: string }> = {}

  loopChildrenNodes.forEach((node) => {
    const nodeVars = getNodeUsedVars(node).filter(item => item && item.length > 0)
    nodeVars.forEach((varSelector) => {
      if (varSelector[0] === currentNodeId)
        return
      if (isNodeInLoop(varSelector[0]))
        return

      const varSelectorStr = varSelector.join('.')
      if (!seenVarSelectors[varSelectorStr]) {
        seenVarSelectors[varSelectorStr] = true
        vars.push(varSelector)
      }

      let passToServerKeys = getNodeUsedVarPassToServerKey(node, varSelector)
      if (typeof passToServerKeys === 'string')
        passToServerKeys = [passToServerKeys]

      passToServerKeys.forEach((key: string, index: number) => {
        allVarObject[[varSelectorStr, node.id, index].join(DELIMITER)] = {
          inSingleRunPassedKey: key,
        }
      })
    })
  })

  const usedOutVars = toVarInputs(vars.map((valueSelector) => {
    const varInfo = getNodeInfoById(canChooseVarNodes, valueSelector[0])
    return {
      label: {
        nodeType: varInfo?.data.type,
        nodeName: varInfo?.data.title || canChooseVarNodes[0]?.data.title,
        variable: isSystemVar(valueSelector) ? valueSelector.join('.') : valueSelector[valueSelector.length - 1],
      },
      variable: valueSelector.join('.'),
      value_selector: valueSelector,
    }
  }))

  return { usedOutVars, allVarObject }
}

export const getDependentVarsFromLoopPayload = ({
  nodeId,
  usedOutVars,
  breakConditions,
  loopVariables,
}: {
  nodeId: string
  usedOutVars: InputVar[]
  breakConditions?: Condition[]
  loopVariables?: LoopVariable[]
}) => {
  const vars: ValueSelector[] = usedOutVars.map(item => item.variable.split('.'))

  breakConditions?.forEach((condition) => {
    vars.push(...getVarSelectorsFromCondition(condition))
  })

  loopVariables?.forEach((loopVariable) => {
    if (loopVariable.value_type === ValueType.variable)
      vars.push(loopVariable.value)
  })

  return vars.filter(item => item[0] !== nodeId)
}
