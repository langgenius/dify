import { useState } from 'react'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { CommonNodeType, InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'

type Params<T> = {
  id: string
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  isInvalid?: () => boolean
}

const useOneStepRun = <T>({ id, data, defaultRunInputData, isInvalid = () => true }: Params<T>) => {
  const { handleNodeDataUpdate }: { handleNodeDataUpdate: (data: any) => void } = useWorkflow()
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
  const handleRun = () => {
    if (isInvalid())
      return

    setRunningStatus('running')
  }

  const handleStop = () => {
    setRunningStatus('not started')
  }

  // TODO: store to node
  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})

  const toVarInputs = (variables: Variable[]): InputVar[] => {
    if (!variables)
      return []

    const varInputs = variables.map((item, i) => {
      const allVarTypes = [InputVarType.textInput, InputVarType.paragraph, InputVarType.number, InputVarType.select, InputVarType.files]
      return {
        label: item.variable,
        variable: item.variable,
        type: allVarTypes[i % allVarTypes.length], // TODO: dynamic get var type
        required: true, // TODO
        options: ['a', 'b', 'c'], // TODO
      }
    })

    return varInputs
  }

  return {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun,
    handleStop,
    setRunningStatus,
    runInputData,
    setRunInputData,
  }
}

export default useOneStepRun
