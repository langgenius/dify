import { useState } from 'react'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { CommonNodeType, InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'
import { RETRIEVAL_OUTPUT_STRUCT } from '@/app/components/workflow/constants'

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

  // TODO: test
  const [inputVarValues, setInputVarValues] = useState<Record<string, any>>({
    name: 'Joel',
    age: '18',
  })

  const [visionFiles, setVisionFiles] = useState<any[]>([])

  const [contexts, setContexts] = useState<string[]>([RETRIEVAL_OUTPUT_STRUCT])

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
    setRunningStatus,
    inputVarValues,
    setInputVarValues,
    visionFiles,
    setVisionFiles,
    contexts,
    setContexts,
  }
}

export default useOneStepRun
