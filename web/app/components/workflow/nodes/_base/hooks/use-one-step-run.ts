import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

import type { CommonNodeType, InputVar, ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import { BlockEnum, InputVarType, NodeRunningStatus, VarType } from '@/app/components/workflow/types'
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
  // beforeRunCheckValid?: () => CheckValidRes // has checked before run button clicked
}

const varTypeToInputVarType = (type: VarType, {
  isSelect,
  isParagraph,
}: {
  isSelect: boolean
  isParagraph: boolean
}) => {
  if (isSelect)
    return InputVarType.select
  if (isParagraph)
    return InputVarType.paragraph
  if (type === VarType.number)
    return InputVarType.number
  if ([VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject].includes(type))
    return InputVarType.json
  if (type === VarType.arrayFile)
    return InputVarType.files

  return InputVarType.textInput
}

const useOneStepRun = <T>({
  id,
  data,
  defaultRunInputData,
  // beforeRunCheckValid = () => ({ isValid: true }),
}: Params<T>) => {
  const { t } = useTranslation()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const isChatMode = useIsChatMode()

  const allOutputVars = toNodeOutputVars(getBeforeNodesInSameBranch(id), isChatMode)
  const getVar = (valueSelector: ValueSelector): Var | undefined => {
    let res: Var | undefined
    const targetVar = allOutputVars.find(v => v.nodeId === valueSelector[0])
    if (!targetVar)
      return undefined

    let curr: any = targetVar.vars
    valueSelector.slice(1).forEach((key, i) => {
      const isLast = i === valueSelector.length - 2
      curr = curr.find((v: any) => v.variable === key)
      if (isLast) {
        res = curr
      }
      else {
        if (curr.type === VarType.object)
          curr = curr.children
      }
    })

    return res
  }

  const checkValid = checkValidFns[data.type]
  const appId = useAppStore.getState().appDetail?.id
  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})
  const [runResult, setRunResult] = useState<any>(null)

  const { handleNodeDataUpdate }: { handleNodeDataUpdate: (data: any) => void } = useNodeDataUpdate()
  const [canShowSingleRun, setCanShowSingleRun] = useState(false)
  const isShowSingleRun = data._isSingleRun && canShowSingleRun
  useEffect(() => {
    if (!checkValid) {
      setCanShowSingleRun(true)
      return
    }

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

  const handleRun = async (submitData: Record<string, any>) => {
    console.log(submitData)
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: NodeRunningStatus.Running,
      },
    })
    let res: any
    try {
      res = await singleNodeRun(appId!, id, { inputs: submitData }) as any
      if (res.error)
        throw new Error(res.error)
    }
    catch (e: any) {
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

    const varInputs = variables.map((item) => {
      const originalVar = getVar(item.value_selector)
      if (!originalVar) {
        return {
          label: item.variable,
          variable: item.variable,
          type: InputVarType.textInput,
          required: true,
        }
      }
      return {
        label: item.variable,
        variable: item.variable,
        type: varTypeToInputVarType(originalVar.type, {
          isSelect: !!originalVar.isSelect,
          isParagraph: !!originalVar.isParagraph,
        }),
        required: item.required !== false,
        options: originalVar.options,
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
