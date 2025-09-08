import type { RefObject } from 'react'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import type { HttpNodeType } from './types'

type Params = {
  id: string,
  payload: HttpNodeType,
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  getInputVars,
  setRunInputData,
}: Params) => {
  const { inputs } = useNodeCrud<HttpNodeType>(id, payload)

  const fileVarInputs = useMemo(() => {
    if (!Array.isArray(inputs.body.data))
      return ''

    const res = inputs.body.data
      .filter(item => item.file?.length)
      .map(item => item.file ? `{{#${item.file.join('.')}#}}` : '')
      .join(' ')
    return res
  }, [inputs.body.data])
  const varInputs = getInputVars([
    inputs.url,
    inputs.headers,
    inputs.params,
    typeof inputs.body.data === 'string' ? inputs.body.data : inputs.body.data?.map(item => item.value).join(''),
    fileVarInputs,
  ])
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

  const getDependentVars = () => {
    return varInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
  }

  return {
    forms,
    getDependentVars,
  }
}

export default useSingleRunFormParams
