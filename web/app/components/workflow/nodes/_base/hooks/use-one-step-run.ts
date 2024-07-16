import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { unionBy } from 'lodash-es'
import produce from 'immer'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { getNodeInfoById, isSystemVar, toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

import type { CommonNodeType, InputVar, ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import { BlockEnum, InputVarType, NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { getIterationSingleNodeRunUrl, singleNodeRun } from '@/service/workflow'
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
import ParameterExtractorDefault from '@/app/components/workflow/nodes/parameter-extractor/default'
import IterationDefault from '@/app/components/workflow/nodes/iteration/default'
import { ssePost } from '@/service/base'

import { getInputVars as doGetInputVars } from '@/app/components/base/prompt-editor/constants'
import type { NodeTracing } from '@/types/workflow'
const { checkValid: checkLLMValid } = LLMDefault
const { checkValid: checkKnowledgeRetrievalValid } = KnowledgeRetrievalDefault
const { checkValid: checkIfElseValid } = IfElseDefault
const { checkValid: checkCodeValid } = CodeDefault
const { checkValid: checkTemplateTransformValid } = TemplateTransformDefault
const { checkValid: checkQuestionClassifyValid } = QuestionClassifyDefault
const { checkValid: checkHttpValid } = HTTPDefault
const { checkValid: checkToolValid } = ToolDefault
const { checkValid: checkVariableAssignerValid } = VariableAssigner
const { checkValid: checkParameterExtractorValid } = ParameterExtractorDefault
const { checkValid: checkIterationValid } = IterationDefault

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
  [BlockEnum.VariableAggregator]: checkVariableAssignerValid,
  [BlockEnum.ParameterExtractor]: checkParameterExtractorValid,
  [BlockEnum.Iteration]: checkIterationValid,
} as any

type Params<T> = {
  id: string
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  moreDataForCheckValid?: any
  iteratorInputKey?: string
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
  iteratorInputKey,
}: Params<T>) => {
  const { t } = useTranslation()
  const { getBeforeNodesInSameBranch, getBeforeNodesInSameBranchIncludeParent } = useWorkflow() as any
  const isChatMode = useIsChatMode()
  const isIteration = data.type === BlockEnum.Iteration

  const availableNodes = getBeforeNodesInSameBranch(id)
  const availableNodesIncludeParent = getBeforeNodesInSameBranchIncludeParent(id)
  const allOutputVars = toNodeOutputVars(availableNodes, isChatMode)
  const getVar = (valueSelector: ValueSelector): Var | undefined => {
    let res: Var | undefined
    const isSystem = valueSelector[0] === 'sys'
    const targetVar = isSystem ? allOutputVars.find(item => !!item.isStartNode) : allOutputVars.find(v => v.nodeId === valueSelector[0])
    if (!targetVar)
      return undefined
    if (isSystem)
      return targetVar.vars.find(item => item.variable.split('.')[1] === valueSelector[1])

    let curr: any = targetVar.vars
    if (!curr)
      return

    valueSelector.slice(1).forEach((key, i) => {
      const isLast = i === valueSelector.length - 2
      curr = curr?.find((v: any) => v.variable === key)
      if (isLast) {
        res = curr
      }
      else {
        if (curr?.type === VarType.object)
          curr = curr.children
      }
    })

    return res
  }

  const checkValid = checkValidFns[data.type]
  const appId = useAppStore.getState().appDetail?.id
  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})
  const iterationTimes = iteratorInputKey ? runInputData[iteratorInputKey].length : 0
  const [runResult, setRunResult] = useState<any>(null)

  const { handleNodeDataUpdate }: { handleNodeDataUpdate: (data: any) => void } = useNodeDataUpdate()
  const [canShowSingleRun, setCanShowSingleRun] = useState(false)
  const isShowSingleRun = data._isSingleRun && canShowSingleRun
  const [iterationRunResult, setIterationRunResult] = useState<NodeTracing[][]>([])

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

  const workflowStore = useWorkflowStore()
  useEffect(() => {
    workflowStore.getState().setShowSingleRunPanel(!!isShowSingleRun)
  }, [isShowSingleRun])

  const hideSingleRun = () => {
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _isSingleRun: false,
      },
    })
  }
  const showSingleRun = () => {
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _isSingleRun: true,
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
      if (!isIteration) {
        res = await singleNodeRun(appId!, id, { inputs: submitData }) as any
      }
      else {
        setIterationRunResult([])
        let _iterationResult: NodeTracing[][] = []
        let _runResult: any = null
        ssePost(
          getIterationSingleNodeRunUrl(isChatMode, appId!, id),
          { body: { inputs: submitData } },
          {
            onWorkflowStarted: () => {
            },
            onWorkflowFinished: (params) => {
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _singleRunningStatus: NodeRunningStatus.Succeeded,
                },
              })
              const { data: iterationData } = params
              _runResult.created_by = iterationData.created_by.name
              setRunResult(_runResult)
            },
            onIterationNext: () => {
              // iteration next trigger time is triggered one more time than iterationTimes
              if (_iterationResult.length >= iterationTimes!)
                return

              const newIterationRunResult = produce(_iterationResult, (draft) => {
                draft.push([])
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onIterationFinish: (params) => {
              _runResult = params.data
              setRunResult(_runResult)
            },
            onNodeStarted: (params) => {
              const newIterationRunResult = produce(_iterationResult, (draft) => {
                draft[draft.length - 1].push({
                  ...params.data,
                  status: NodeRunningStatus.Running,
                } as NodeTracing)
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onNodeFinished: (params) => {
              const iterationRunResult = _iterationResult

              const { data } = params
              const currentIndex = iterationRunResult[iterationRunResult.length - 1].findIndex(trace => trace.node_id === data.node_id)
              const newIterationRunResult = produce(iterationRunResult, (draft) => {
                if (currentIndex > -1) {
                  draft[draft.length - 1][currentIndex] = {
                    ...data,
                    status: NodeRunningStatus.Succeeded,
                  } as NodeTracing
                }
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onError: () => {
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _singleRunningStatus: NodeRunningStatus.Failed,
                },
              })
            },
          },
        )
      }
      if (res.error)
        throw new Error(res.error)
    }
    catch (e: any) {
      if (!isIteration) {
        handleNodeDataUpdate({
          id,
          data: {
            ...data,
            _singleRunningStatus: NodeRunningStatus.Failed,
          },
        })
        return false
      }
    }
    finally {
      if (!isIteration) {
        setRunResult({
          ...res,
          total_tokens: res.execution_metadata?.total_tokens || 0,
          created_by: res.created_by_account?.name || '',
        })
      }
    }
    if (!isIteration) {
      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _singleRunningStatus: NodeRunningStatus.Succeeded,
        },
      })
    }
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
          value_selector: item.value_selector,
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
      const varInfo = getNodeInfoById(availableNodesIncludeParent, item[0])?.data

      return {
        label: {
          nodeType: varInfo?.type,
          nodeName: varInfo?.title || availableNodesIncludeParent[0]?.data.title, // default start node title
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
    showSingleRun,
    toVarInputs,
    getInputVars,
    runningStatus,
    isCompleted,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
    iterationRunResult,
  }
}

export default useOneStepRun
