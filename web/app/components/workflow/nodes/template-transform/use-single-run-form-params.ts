import type { RefObject } from 'react'
import type { TemplateTransformNodeType } from './types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'

type Params = {
  id: string
  payload: TemplateTransformNodeType
  runInputData: Record<string, unknown>
  runInputDataRef: RefObject<Record<string, unknown>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, unknown>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  toVarInputs,
  setRunInputData,
}: Params) => {
  const { inputs } = useNodeCrud<TemplateTransformNodeType>(id, payload)

  const varInputs = toVarInputs(inputs.variables)
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

  const forms = useMemo(() => {
    return [
      {
        inputs: varInputs,
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    ]
  }, [inputVarValues, setInputVarValues, varInputs])

  const getDependentVars = () => {
    return payload.variables.map((v) => v.value_selector)
  }

  const getDependentVar = (variable: string) => {
    const varItem = payload.variables.find((v) => v.variable === variable)
    if (varItem) return varItem.value_selector
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
