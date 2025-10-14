import type { RefObject } from 'react'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import type { VariableAssignerNodeType } from './types'

type Params = {
  id: string,
  payload: VariableAssignerNodeType,
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
      if(!input)
        return
      if (!existVarsKey[input.variable]) {
        existVarsKey[input.variable] = true
        uniqueVarInputs.push({
          ...input,
          required: false, // just one of the inputs is required
        })
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
    if(payload.advanced_settings?.group_enabled) {
      const vars: ValueSelector[][] = []
      payload.advanced_settings.groups.forEach((group) => {
        if(group.variables)
          vars.push([...group.variables])
      })
      return vars
    }
    return [payload.variables]
  }

  return {
    forms,
    getDependentVars,
  }
}

export default useSingleRunFormParams
