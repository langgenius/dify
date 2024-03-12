import { useState } from 'react'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { CommonNodeType, InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType, NodeRunningStatus } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { singleNodeRun } from '@/service/workflow'

type Params<T> = {
  id: string
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  isInvalid?: () => boolean
}

const useOneStepRun = <T>({ id, data, defaultRunInputData, isInvalid = () => true }: Params<T>) => {
  const appId = useAppStore.getState().appDetail?.id
  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})

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
  const runningStatus = data._singleRunningStatus || NodeRunningStatus.NotStart
  const handleRun = async () => {
    if (!isInvalid())
      return
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: NodeRunningStatus.Running,
      },
    })

    const res = await singleNodeRun(appId!, id, { inputs: runInputData })
    console.log(res)
  }

  const handleStop = () => {
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: NodeRunningStatus.NotStart,
      },
    })
  }

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
    runInputData,
    setRunInputData,
  }
}

export default useOneStepRun
