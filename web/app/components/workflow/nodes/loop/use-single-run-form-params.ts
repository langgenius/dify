import type { NodeTracing } from '@/types/workflow'
import { useCallback, useMemo } from 'react'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import { useTranslation } from 'react-i18next'
import type { InputVar, ValueSelector } from '../../types'
import type { CaseItem, Condition, LoopNodeType } from './types'
import { ValueType } from '@/app/components/workflow/types'

type Params = {
  payload: LoopNodeType
  runInputData: Record<string, any>
  runResult: NodeTracing
  loopRunResult: NodeTracing[]
  setRunInputData: (data: Record<string, any>) => void
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}

const useSingleRunFormParams = ({
  payload,
  runInputData,
  runResult,
  loopRunResult,
  setRunInputData,
  varSelectorsToVarInputs,
}: Params) => {
  const { t } = useTranslation()
  const nodeInfo = useMemo(() => {
    const formattedNodeInfo = formatTracing(loopRunResult, t)[0]

    if (runResult && formattedNodeInfo) {
      return {
        ...formattedNodeInfo,
        execution_metadata: {
          ...runResult.execution_metadata,
          ...formattedNodeInfo.execution_metadata,
        },
      }
    }

    return formattedNodeInfo
  }, [runResult, loopRunResult, t])

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

  const forms = (() => {
    const allInputs: ValueSelector[] = []
    payload.break_conditions?.forEach((condition) => {
      const vars = getVarSelectorsFromCondition(condition)
      allInputs.push(...vars)
    })

    payload.loop_variables?.forEach((loopVariable) => {
      if(loopVariable.value_type === ValueType.variable)
        allInputs.push(loopVariable.value)
    })
    const inputVarsFromValue: InputVar[] = []
    const varInputs = [...varSelectorsToVarInputs(allInputs), ...inputVarsFromValue]

    const existVarsKey: Record<string, boolean> = {}
    const uniqueVarInputs: InputVar[] = []
    varInputs.forEach((input) => {
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
    payload.break_conditions?.forEach((condition) => {
      const conditionVars = getVarFromCondition(condition)
      vars.push(...conditionVars)
    })
    payload.loop_variables?.forEach((loopVariable) => {
      if(loopVariable.value_type === ValueType.variable)
        vars.push(loopVariable.value)
    })
    return vars
  }

  return {
    forms,
    nodeInfo,
    getDependentVars,
  }
}

export default useSingleRunFormParams
