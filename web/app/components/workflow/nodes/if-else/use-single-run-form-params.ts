import type { RefObject } from 'react'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import type { CaseItem, Condition, IfElseNodeType } from './types'

type Params = {
  id: string,
  payload: IfElseNodeType,
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}
const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
  getInputVars,
  varSelectorsToVarInputs,
}: Params) => {
  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    setRunInputData(newPayload)
  }, [setRunInputData])
  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const getVarSelectorsFromCase = (caseItem: CaseItem): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (caseItem.conditions && caseItem.conditions.length) {
      caseItem.conditions.forEach((condition) => {
        // eslint-disable-next-line ts/no-use-before-define
        const conditionVars = getVarSelectorsFromCondition(condition)
        vars.push(...conditionVars)
      })
    }
    return vars
  }

  const getVarSelectorsFromCondition = (condition: Condition) => {
    const vars: ValueSelector[] = []
    if (condition.variable_selector)
      vars.push(condition.variable_selector)

    if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      vars.push(...getVarSelectorsFromCase(condition.sub_variable_condition))
    return vars
  }

  const getInputVarsFromCase = (caseItem: CaseItem): InputVar[] => {
    const vars: InputVar[] = []
    if (caseItem.conditions && caseItem.conditions.length) {
      caseItem.conditions.forEach((condition) => {
        // eslint-disable-next-line ts/no-use-before-define
        const conditionVars = getInputVarsFromConditionValue(condition)
        vars.push(...conditionVars)
      })
    }
    return vars
  }

  const getInputVarsFromConditionValue = (condition: Condition): InputVar[] => {
    const vars: InputVar[] = []
    if (condition.value && typeof condition.value === 'string') {
      const inputVars = getInputVars([condition.value])
      vars.push(...inputVars)
    }

    if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      vars.push(...getInputVarsFromCase(condition.sub_variable_condition))

    return vars
  }

  const forms = (() => {
    const allInputs: ValueSelector[] = []
    const inputVarsFromValue: InputVar[] = []
    if (payload.cases && payload.cases.length) {
      payload.cases.forEach((caseItem) => {
        const caseVars = getVarSelectorsFromCase(caseItem)
        allInputs.push(...caseVars)
        inputVarsFromValue.push(...getInputVarsFromCase(caseItem))
      })
    }

    if (payload.conditions && payload.conditions.length) {
      payload.conditions.forEach((condition) => {
        const conditionVars = getVarSelectorsFromCondition(condition)
        allInputs.push(...conditionVars)
        inputVarsFromValue.push(...getInputVarsFromConditionValue(condition))
      })
    }

    const varInputs = [...varSelectorsToVarInputs(allInputs), ...inputVarsFromValue]
    // remove duplicate inputs
    const existVarsKey: Record<string, boolean> = {}
    const uniqueVarInputs: InputVar[] = []
    varInputs.forEach((input) => {
      if(!input)
        return
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

  const getVarFromCaseItem = (caseItem: CaseItem): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (caseItem.conditions && caseItem.conditions.length) {
      caseItem.conditions.forEach((condition) => {
        // eslint-disable-next-line ts/no-use-before-define
        const conditionVars = getVarFromCondition(condition)
        vars.push(...conditionVars)
      })
    }
    return vars
  }
  const getVarFromCondition = (condition: Condition): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (condition.variable_selector)
      vars.push(condition.variable_selector)

    if(condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      vars.push(...getVarFromCaseItem(condition.sub_variable_condition))
    return vars
  }

  const getDependentVars = () => {
    const vars: ValueSelector[] = []
    if (payload.cases && payload.cases.length) {
      payload.cases.forEach((caseItem) => {
        const caseVars = getVarFromCaseItem(caseItem)
        vars.push(...caseVars)
      })
    }

    if (payload.conditions && payload.conditions.length) {
      payload.conditions.forEach((condition) => {
        const conditionVars = getVarFromCondition(condition)
        vars.push(...conditionVars)
      })
    }
    return vars
  }
  return {
    forms,
    getDependentVars,
  }
}

export default useSingleRunFormParams
