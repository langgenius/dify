import type { RefObject } from 'react'
import type { AssignerNodeType } from './types'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { WriteMode, writeModeTypesNum } from './types'

type Params = {
  id: string
  payload: AssignerNodeType
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  setRunInputData,
  varSelectorsToVarInputs,
}: Params) => {
  const { inputs } = useNodeCrud<AssignerNodeType>(id, payload)

  const vars = (inputs.items ?? []).filter((item) => {
    return item.operation !== WriteMode.clear && item.operation !== WriteMode.set
      && item.operation !== WriteMode.removeFirst && item.operation !== WriteMode.removeLast
      && !writeModeTypesNum.includes(item.operation)
  }).map(item => item.value as ValueSelector)

  const forms = useMemo(() => {
    const varInputs = varSelectorsToVarInputs(vars)

    return [
      {
        inputs: varInputs,
        values: runInputData,
        onChange: setRunInputData,
      },
    ]
  }, [runInputData, setRunInputData, varSelectorsToVarInputs, vars])

  const getDependentVars = () => {
    return vars
  }

  return {
    forms,
    getDependentVars,
  }
}

export default useSingleRunFormParams
