import { useState } from 'react'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { CommonNodeType, InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'

type Params<T> = {
  id: string
  data: CommonNodeType<T>
}

const useOneStepRun = <T>({ id, data }: Params<T>) => {
  const { handleNodeDataUpdate } = useWorkflow()
  const isShowSingleRun = data._isSingleRun
  const hideSingleRun = () => {
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _isSingleRun: false,
      },
    })
  }

  const [runningStatus, setRunningStatus] = useState('un started')

  const toVarInputs = (variables: Variable[]): InputVar[] => {
    if (!variables)
      return []

    const varInputs = variables.map((item) => {
      return {
        label: item.variable,
        variable: item.variable,
        type: InputVarType.textInput, // TODO: dynamic get var type
        required: true, // TODO
        options: [], // TODO
      }
    })

    return varInputs
  }

  return {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    setRunningStatus,
  }
}

export default useOneStepRun
