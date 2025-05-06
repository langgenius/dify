import type { MutableRefObject } from 'react'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import type { VariableAssignerNodeType } from './types'

type Params = {
  id: string,
  payload: VariableAssignerNodeType,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}
const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
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

  const forms = (() => {
    const allInputs: ValueSelector[] = []
    const isGroupEnabled = !!payload.advanced_settings?.group_enabled
    if (!isGroupEnabled && payload.variables && payload.variables.length) {
      payload.variables.forEach((varSelector) => {
        allInputs.push(varSelector)
      })
    }
    if (isGroupEnabled && payload.advanced_settings && payload.advanced_settings.groups && payload.advanced_settings.groups.length) {
      payload.advanced_settings.groups.forEach((group) => {
        group.variables?.forEach((varSelector) => {
          allInputs.push(varSelector)
        })
      })
    }

    const varInputs = varSelectorsToVarInputs(allInputs)
    // remove duplicate inputs
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

  return {
    forms,
  }
}

export default useSingleRunFormParams
