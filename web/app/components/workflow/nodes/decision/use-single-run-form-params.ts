import type { RefObject } from 'react'
import type { Condition } from '../if-else/types'
import type { DecisionNodeType, RuleGroup } from './types'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { DecideBy } from './types'

type Params = {
  id: string
  payload: DecisionNodeType
  runInputData: Record<string, unknown>
  runInputDataRef: RefObject<Record<string, unknown>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, unknown>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}
const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
  getInputVars,
  toVarInputs,
  varSelectorsToVarInputs,
}: Params) => {
  const setInputVarValues = useCallback(
    (newPayload: Record<string, unknown>) => {
      setRunInputData(newPayload)
    },
    [setRunInputData],
  )
  const inputVarValues = (() => {
    const vars: Record<string, unknown> = {}
    Object.keys(runInputData).forEach((key) => {
      vars[key] = runInputData[key]
    })
    return vars
  })()

  const getVarSelectorsFromCondition = (condition: Condition): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (condition.variable_selector) vars.push(condition.variable_selector)

    if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      // oxlint-disable-next-line typescript/no-use-before-define -- the two helpers recurse into each other
      vars.push(...getVarSelectorsFromRuleGroup(condition.sub_variable_condition))

    return vars
  }

  const getVarSelectorsFromRuleGroup = (ruleGroup: RuleGroup): ValueSelector[] => {
    const vars: ValueSelector[] = []
    ruleGroup.conditions?.forEach((condition) => {
      vars.push(...getVarSelectorsFromCondition(condition))
    })
    return vars
  }

  const getInputVarsFromRuleGroup = (ruleGroup: RuleGroup): InputVar[] => {
    const vars: InputVar[] = []
    ruleGroup.conditions?.forEach((condition) => {
      if (condition.value && typeof condition.value === 'string')
        vars.push(...getInputVars([condition.value]))

      if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
        vars.push(...getInputVarsFromRuleGroup(condition.sub_variable_condition))
    })
    return vars
  }

  const forms = (() => {
    let varInputs: InputVar[] = []

    if (payload.decide_by === DecideBy.llm) varInputs = toVarInputs(payload.inputs || [])
    else {
      const allInputs: ValueSelector[] = []
      const inputVarsFromValue: InputVar[] = []
      payload.outcomes?.forEach((outcome) => {
        if (typeof outcome.when === 'object' && outcome.when !== null) {
          allInputs.push(...getVarSelectorsFromRuleGroup(outcome.when))
          inputVarsFromValue.push(...getInputVarsFromRuleGroup(outcome.when))
        }
      })
      varInputs = [...varSelectorsToVarInputs(allInputs), ...inputVarsFromValue]
    }

    // remove duplicate inputs
    const existVarsKey: Record<string, boolean> = {}
    const uniqueVarInputs: InputVar[] = []
    varInputs.forEach((input) => {
      if (!input) return
      if (!existVarsKey[input.variable]) {
        existVarsKey[input.variable] = true
        uniqueVarInputs.push(input)
      }
    })

    return [
      {
        inputs: uniqueVarInputs,
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    ]
  })()

  const getDependentVars = () => {
    if (payload.decide_by === DecideBy.llm)
      return (payload.inputs || []).map((variable) => variable.value_selector)

    const vars: ValueSelector[] = []
    payload.outcomes?.forEach((outcome) => {
      if (typeof outcome.when === 'object' && outcome.when !== null)
        vars.push(...getVarSelectorsFromRuleGroup(outcome.when))
    })
    return vars
  }

  const getDependentVar = (variable: string) => {
    if (payload.decide_by === DecideBy.llm) {
      const varItem = (payload.inputs || []).find((item) => item.variable === variable)
      if (varItem) return varItem.value_selector
    }

    return false
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
