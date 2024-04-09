import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { unionBy } from 'lodash-es'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { getNodeInfoById, isSystemVar, toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

import type { CommonNodeType, InputVar, ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import { BlockEnum, InputVarType, NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { singleNodeRun } from '@/service/workflow'
import Toast from '@/app/components/base/toast'
import LLMDefault from '@/app/components/workflow/nodes/llm/default'
import KnowledgeRetrievalDefault from '@/app/components/workflow/nodes/knowledge-retrieval/default'
import IfElseDefault from '@/app/components/workflow/nodes/if-else/default'
import CodeDefault from '@/app/components/workflow/nodes/code/default'
import TemplateTransformDefault from '@/app/components/workflow/nodes/template-transform/default'
import QuestionClassifyDefault from '@/app/components/workflow/nodes/question-classifier/default'
import HTTPDefault from '@/app/components/workflow/nodes/http/default'
import ToolDefault from '@/app/components/workflow/nodes/tool/default'
import VariableAssigner from '@/app/components/workflow/nodes/variable-assigner/default'
import { getInputVars as doGetInputVars } from '@/app/components/base/prompt-editor/constants'
const { checkValid: checkLLMValid } = LLMDefault
const { checkValid: checkKnowledgeRetrievalValid } = KnowledgeRetrievalDefault
const { checkValid: checkIfElseValid } = IfElseDefault
const { checkValid: checkCodeValid } = CodeDefault
const { checkValid: checkTemplateTransformValid } = TemplateTransformDefault
const { checkValid: checkQuestionClassifyValid } = QuestionClassifyDefault
const { checkValid: checkHttpValid } = HTTPDefault
const { checkValid: checkToolValid } = ToolDefault
const { checkValid: checkVariableAssignerValid } = VariableAssigner

const checkValidFns: Record<BlockEnum, Function> = {
  [BlockEnum.LLM]: checkLLMValid,
  [BlockEnum.KnowledgeRetrieval]: checkKnowledgeRetrievalValid,
  [BlockEnum.IfElse]: checkIfElseValid,
  [BlockEnum.Code]: checkCodeValid,
  [BlockEnum.TemplateTransform]: checkTemplateTransformValid,
  [BlockEnum.QuestionClassifier]: checkQuestionClassifyValid,
  [BlockEnum.HttpRequest]: checkHttpValid,
  [BlockEnum.Tool]: checkToolValid,
  [BlockEnum.VariableAssigner]: checkVariableAssignerValid,
} as any

type Params<T> = {
  id: string
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  moreDataForCheckValid?: any
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
  moreDataForCheckValid,
}: Params<T>) => {
  const { t } = useTranslation()
  const { getBeforeNodesInSameBranch } = useWorkflow() as any
  const isChatMode = useIsChatMode()

  const availableNodes = getBeforeNodesInSameBranch(id)
  const allOutputVars = toNodeOutputVars(getBeforeNodesInSameBranch(id), isChatMode)
  const getVar = (valueSelector: ValueSelector): Var | undefined => {
    let res: Var | undefined
    const isSystem = valueSelector[0] === 'sys'
    const targetVar = isSystem ? allOutputVars.find(item => !!item.isStartNode) : allOutputVars.find(v => v.nodeId === valueSelector[0])
    if (!targetVar)
      return undefined
    if (isSystem)
      return targetVar.vars.find(item => item.variable.split('.')[1] === valueSelector[1])

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
      const { isValid, errorMessage } = checkValid(data, t, moreDataForCheckValid)
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
          label: item.label || item.variable,
          variable: item.variable,
          type: InputVarType.textInput,
          required: true,
        }
      }
      return {
        label: item.label || item.variable,
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

  const getInputVars = (textList: string[]) => {
    const valueSelectors: ValueSelector[] = []
    textList.forEach((text) => {
      valueSelectors.push(...doGetInputVars(text))
    })

    const variables = unionBy(valueSelectors, item => item.join('.')).map((item) => {
      const varInfo = getNodeInfoById(availableNodes, item[0])?.data

      return {
        label: {
          nodeType: varInfo?.type,
          nodeName: varInfo?.title || availableNodes[0]?.data.title, // default start node title
          variable: isSystemVar(item) ? item.join('.') : item[item.length - 1],
        },
        variable: `#${item.join('.')}#`,
        value_selector: item,
      }
    })

    const varInputs = toVarInputs(variables)
    return varInputs
  }

  return {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    getInputVars,
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
