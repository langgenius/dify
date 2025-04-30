import type { MutableRefObject } from 'react'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import type { CodeNodeType } from './types'

type Params = {
  id: string,
  payload: CodeNodeType,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  toVarInputs,
  setRunInputData,
}: Params) => {
  const { inputs } = useNodeCrud<CodeNodeType>(id, payload)

  const varInputs = toVarInputs(inputs.variables)
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

  const forms = useMemo(() => {
    return [
      {
        inputs: varInputs,
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    ]
  }, [inputVarValues, setInputVarValues, varInputs])

  return {
    forms,
  }
}

export default useSingleRunFormParams
