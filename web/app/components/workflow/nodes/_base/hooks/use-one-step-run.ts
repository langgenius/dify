import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type { CheckValidRes, CommonNodeType, InputVar, Variable } from '@/app/components/workflow/types'
import { BlockEnum, InputVarType, NodeRunningStatus } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { singleNodeRun } from '@/service/workflow'
import Toast from '@/app/components/base/toast'
import CodeDefault from '@/app/components/workflow/nodes/code/default'
import HTTPDefault from '@/app/components/workflow/nodes/http/default'
const { checkValid: checkCodeValid } = CodeDefault

const checkValidFns: Record<BlockEnum, Function> = {
  [BlockEnum.Code]: checkCodeValid,
  [BlockEnum.HttpRequest]: HTTPDefault.checkValid,
} as any

type Params<T> = {
  id: string
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  beforeRunCheckValid?: () => CheckValidRes
}

const useOneStepRun = <T>({
  id,
  data,
  defaultRunInputData,
  beforeRunCheckValid = () => ({ isValid: true }),
}: Params<T>) => {
  const { t } = useTranslation()
  const checkValid = checkValidFns[data.type]
  const appId = useAppStore.getState().appDetail?.id
  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})
  const [runResult, setRunResult] = useState<any>(null)

  const { handleNodeDataUpdate }: { handleNodeDataUpdate: (data: any) => void } = useNodeDataUpdate()
  const [canShowSingleRun, setCanShowSingleRun] = useState(false)
  const isShowSingleRun = data._isSingleRun && canShowSingleRun
  useEffect(() => {
    if (data._isSingleRun) {
      const { isValid, errorMessage } = checkValid(data, t)
      setCanShowSingleRun(isValid)
      if (!isValid) {
        handleNodeDataUpdate({
          id,
          data: {
            ...data,
            _isSingleRun: false,
          },
        })
        Toast.notify({
          type: 'error',
          message: errorMessage,
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data._isSingleRun])
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
    const { isValid, errorMessage } = beforeRunCheckValid()
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: errorMessage!,
      })
      return false
    }
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
      // Toast.notify({
      //   type: 'error',
      //   message: e.toString(),
      // })
      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _singleRunningStatus: NodeRunningStatus.Failed,
        },
      })
      return false
    }
    finally {
      setRunResult({
        ...res,
        created_by: res.created_by_account?.name || '',
      })
    }
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: NodeRunningStatus.Succeeded,
      },
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
