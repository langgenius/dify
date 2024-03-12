import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { CommonNodeType, InputVar, Variable } from '@/app/components/workflow/types'
import { InputVarType, NodeRunningStatus } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { singleNodeRun } from '@/service/workflow'
import Toast from '@/app/components/base/toast'

type Params<T> = {
  id: string
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  isInvalid?: () => boolean
}

const useOneStepRun = <T>({ id, data, defaultRunInputData, isInvalid = () => true }: Params<T>) => {
  const { t } = useTranslation()

  const appId = useAppStore.getState().appDetail?.id
  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})
  const [runResult, setRunResult] = useState<any>(null)

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
  const isCompleted = runningStatus === NodeRunningStatus.Succeeded || runningStatus === NodeRunningStatus.Failed
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
    let res: any
    try {
      res = await singleNodeRun(appId!, id, { inputs: runInputData }) as any
      if (res.error)
        throw new Error(res.error)
    }
    catch (e: any) {
      Toast.notify({
        type: 'error',
        message: e.toString(),
      })
      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _singleRunningStatus: NodeRunningStatus.Failed,
        },
      })
      return false
    }
    setRunResult(res)
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: NodeRunningStatus.Succeeded,
      },
    })
    Toast.notify({
      type: 'success',
      message: t('common.api.success'),
    })
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
    isCompleted,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  }
}

export default useOneStepRun
