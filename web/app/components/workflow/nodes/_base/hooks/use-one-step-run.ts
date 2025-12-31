import type { CommonNodeType, InputVar, TriggerNodeType, ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import type { FlowType } from '@/types/common'
import type { NodeRunResult, NodeTracing } from '@/types/workflow'
import { unionBy } from 'es-toolkit/compat'
import { noop } from 'es-toolkit/function'

import { produce } from 'immer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useStoreApi,
} from 'reactflow'
import { trackEvent } from '@/app/components/base/amplitude'
import { getInputVars as doGetInputVars } from '@/app/components/base/prompt-editor/constants'
import Toast from '@/app/components/base/toast'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { getNodeInfoById, isConversationVar, isENV, isSystemVar, toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import Assigner from '@/app/components/workflow/nodes/assigner/default'
import CodeDefault from '@/app/components/workflow/nodes/code/default'
import DocumentExtractorDefault from '@/app/components/workflow/nodes/document-extractor/default'
import HTTPDefault from '@/app/components/workflow/nodes/http/default'
import IfElseDefault from '@/app/components/workflow/nodes/if-else/default'
import IterationDefault from '@/app/components/workflow/nodes/iteration/default'
import KnowledgeRetrievalDefault from '@/app/components/workflow/nodes/knowledge-retrieval/default'
import LLMDefault from '@/app/components/workflow/nodes/llm/default'
import LoopDefault from '@/app/components/workflow/nodes/loop/default'
import ParameterExtractorDefault from '@/app/components/workflow/nodes/parameter-extractor/default'
import QuestionClassifyDefault from '@/app/components/workflow/nodes/question-classifier/default'
import TemplateTransformDefault from '@/app/components/workflow/nodes/template-transform/default'
import ToolDefault from '@/app/components/workflow/nodes/tool/default'
import VariableAssigner from '@/app/components/workflow/nodes/variable-assigner/default'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  InputVarType,
  NodeRunningStatus,
  VarType,
  WorkflowRunningStatus,
} from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { post, ssePost } from '@/service/base'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useInvalidLastRun } from '@/service/use-workflow'
import { fetchNodeInspectVars, getIterationSingleNodeRunUrl, getLoopSingleNodeRunUrl, singleNodeRun } from '@/service/workflow'
import useMatchSchemaType from '../components/variable/use-match-schema-type'

const { checkValid: checkLLMValid } = LLMDefault
const { checkValid: checkKnowledgeRetrievalValid } = KnowledgeRetrievalDefault
const { checkValid: checkIfElseValid } = IfElseDefault
const { checkValid: checkCodeValid } = CodeDefault
const { checkValid: checkTemplateTransformValid } = TemplateTransformDefault
const { checkValid: checkQuestionClassifyValid } = QuestionClassifyDefault
const { checkValid: checkHttpValid } = HTTPDefault
const { checkValid: checkToolValid } = ToolDefault
const { checkValid: checkVariableAssignerValid } = VariableAssigner
const { checkValid: checkAssignerValid } = Assigner
const { checkValid: checkParameterExtractorValid } = ParameterExtractorDefault
const { checkValid: checkIterationValid } = IterationDefault
const { checkValid: checkDocumentExtractorValid } = DocumentExtractorDefault
const { checkValid: checkLoopValid } = LoopDefault

// eslint-disable-next-line ts/no-unsafe-function-type
const checkValidFns: Partial<Record<BlockEnum, Function>> = {
  [BlockEnum.LLM]: checkLLMValid,
  [BlockEnum.KnowledgeRetrieval]: checkKnowledgeRetrievalValid,
  [BlockEnum.IfElse]: checkIfElseValid,
  [BlockEnum.Code]: checkCodeValid,
  [BlockEnum.TemplateTransform]: checkTemplateTransformValid,
  [BlockEnum.QuestionClassifier]: checkQuestionClassifyValid,
  [BlockEnum.HttpRequest]: checkHttpValid,
  [BlockEnum.Tool]: checkToolValid,
  [BlockEnum.VariableAssigner]: checkAssignerValid,
  [BlockEnum.VariableAggregator]: checkVariableAssignerValid,
  [BlockEnum.ParameterExtractor]: checkParameterExtractorValid,
  [BlockEnum.Iteration]: checkIterationValid,
  [BlockEnum.DocExtractor]: checkDocumentExtractorValid,
  [BlockEnum.Loop]: checkLoopValid,
}

type RequestError = {
  message: string
  status: string
}

export type Params<T> = {
  id: string
  flowId: string
  flowType: FlowType
  data: CommonNodeType<T>
  defaultRunInputData: Record<string, any>
  moreDataForCheckValid?: any
  iteratorInputKey?: string
  loopInputKey?: string
  isRunAfterSingleRun: boolean
  isPaused: boolean
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
  if (type === VarType.boolean)
    return InputVarType.checkbox
  if ([VarType.object, VarType.array, VarType.arrayNumber, VarType.arrayString, VarType.arrayObject].includes(type))
    return InputVarType.json
  if (type === VarType.file)
    return InputVarType.singleFile
  if (type === VarType.arrayFile)
    return InputVarType.multiFiles

  return InputVarType.textInput
}

const useOneStepRun = <T>({
  id,
  flowId,
  flowType,
  data,
  defaultRunInputData,
  moreDataForCheckValid,
  iteratorInputKey,
  loopInputKey,
  isRunAfterSingleRun,
  isPaused,
}: Params<T>) => {
  const { t } = useTranslation()
  const { getBeforeNodesInSameBranch, getBeforeNodesInSameBranchIncludeParent } = useWorkflow() as any
  const conversationVariables = useStore(s => s.conversationVariables)
  const isChatMode = useIsChatMode()
  const isIteration = data.type === BlockEnum.Iteration
  const isLoop = data.type === BlockEnum.Loop
  const isStartNode = data.type === BlockEnum.Start

  const availableNodes = getBeforeNodesInSameBranch(id)
  const availableNodesIncludeParent = getBeforeNodesInSameBranchIncludeParent(id)
  const workflowStore = useWorkflowStore()
  const { schemaTypeDefinitions } = useMatchSchemaType()

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const getVar = (valueSelector: ValueSelector): Var | undefined => {
    const isSystem = valueSelector[0] === 'sys'
    const {
      dataSourceList,
    } = workflowStore.getState()
    const allPluginInfoList = {
      buildInTools: buildInTools || [],
      customTools: customTools || [],
      workflowTools: workflowTools || [],
      mcpTools: mcpTools || [],
      dataSourceList: dataSourceList || [],
    }

    const allOutputVars = toNodeOutputVars(availableNodes, isChatMode, undefined, undefined, conversationVariables, [], allPluginInfoList, schemaTypeDefinitions)
    const targetVar = allOutputVars.find(item => isSystem ? !!item.isStartNode : item.nodeId === valueSelector[0])
    if (!targetVar)
      return undefined

    if (isSystem)
      return targetVar.vars.find(item => item.variable.split('.')[1] === valueSelector[1])

    let curr: any = targetVar.vars
    for (let i = 1; i < valueSelector.length; i++) {
      const key = valueSelector[i]
      const isLast = i === valueSelector.length - 1

      if (Array.isArray(curr))
        curr = curr.find((v: any) => v.variable.replace('conversation.', '') === key)

      if (isLast)
        return curr
      else if (curr?.type === VarType.object || curr?.type === VarType.file)
        curr = curr.children
    }

    return undefined
  }

  const checkValid = checkValidFns[data.type]

  const [runInputData, setRunInputData] = useState<Record<string, any>>(defaultRunInputData || {})
  const runInputDataRef = useRef(runInputData)
  const handleSetRunInputData = useCallback((data: Record<string, any>) => {
    runInputDataRef.current = data
    setRunInputData(data)
  }, [])
  const iterationTimes = iteratorInputKey ? runInputData[iteratorInputKey]?.length : 0
  const loopTimes = loopInputKey ? runInputData[loopInputKey]?.length : 0

  const store = useStoreApi()
  const {
    setShowSingleRunPanel,
    setIsListening,
    setListeningTriggerType,
    setListeningTriggerNodeId,
    setListeningTriggerNodeIds,
    setListeningTriggerIsAll,
    setShowVariableInspectPanel,
  } = workflowStore.getState()
  const updateNodeInspectRunningState = useCallback((nodeId: string, isRunning: boolean) => {
    const {
      nodesWithInspectVars,
      setNodesWithInspectVars,
    } = workflowStore.getState()

    let hasChanges = false
    const nodes = produce(nodesWithInspectVars, (draft) => {
      const index = draft.findIndex(node => node.nodeId === nodeId)
      if (index !== -1) {
        const targetNode = draft[index]
        if (targetNode.isSingRunRunning !== isRunning) {
          targetNode.isSingRunRunning = isRunning
          if (isRunning)
            targetNode.isValueFetched = false
          hasChanges = true
        }
      }
      else if (isRunning) {
        const { getNodes } = store.getState()
        const target = getNodes().find(node => node.id === nodeId)
        if (target) {
          draft.unshift({
            nodeId,
            nodeType: target.data.type,
            title: target.data.title,
            vars: [],
            nodePayload: target.data,
            isSingRunRunning: true,
            isValueFetched: false,
          })
          hasChanges = true
        }
      }
    })

    if (hasChanges)
      setNodesWithInspectVars(nodes)
  }, [workflowStore, store])
  const invalidLastRun = useInvalidLastRun(flowType, flowId!, id)
  const [runResult, doSetRunResult] = useState<NodeRunResult | null>(null)
  const {
    appendNodeInspectVars,
    invalidateSysVarValues,
    invalidateConversationVarValues,
  } = useInspectVarsCrud()
  const runningStatus = data._singleRunningStatus || NodeRunningStatus.NotStart
  const webhookSingleRunActiveRef = useRef(false)
  const webhookSingleRunAbortRef = useRef<AbortController | null>(null)
  const webhookSingleRunTimeoutRef = useRef<number | undefined>(undefined)
  const webhookSingleRunTokenRef = useRef(0)
  const webhookSingleRunDelayResolveRef = useRef<(() => void) | null>(null)
  const pluginSingleRunActiveRef = useRef(false)
  const pluginSingleRunAbortRef = useRef<AbortController | null>(null)
  const pluginSingleRunTimeoutRef = useRef<number | undefined>(undefined)
  const pluginSingleRunTokenRef = useRef(0)
  const pluginSingleRunDelayResolveRef = useRef<(() => void) | null>(null)
  const isPausedRef = useRef(isPaused)
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])
  const { eventEmitter } = useEventEmitterContextContext()

  const isScheduleTriggerNode = data.type === BlockEnum.TriggerSchedule
  const isWebhookTriggerNode = data.type === BlockEnum.TriggerWebhook
  const isPluginTriggerNode = data.type === BlockEnum.TriggerPlugin
  const isTriggerNode = isWebhookTriggerNode || isPluginTriggerNode || isScheduleTriggerNode

  const setRunResult = useCallback(async (data: NodeRunResult | null) => {
    const isPaused = isPausedRef.current

    // The backend don't support pause the single run, so the frontend handle the pause state.
    if (isPaused)
      return

    const canRunLastRun = !isRunAfterSingleRun || runningStatus === NodeRunningStatus.Succeeded
    if (!canRunLastRun) {
      doSetRunResult(data)
      return
    }

    // run fail may also update the inspect vars when the node set the error default output.
    const vars = await fetchNodeInspectVars(flowType, flowId!, id)
    const { getNodes } = store.getState()
    const nodes = getNodes()
    appendNodeInspectVars(id, vars, nodes)
    updateNodeInspectRunningState(id, false)
    if (data?.status === NodeRunningStatus.Succeeded) {
      invalidLastRun()
      if (isStartNode || isTriggerNode)
        invalidateSysVarValues()
      invalidateConversationVarValues() // loop, iteration, variable assigner node can update the conversation variables, but to simple the logic(some nodes may also can update in the future), all nodes refresh.
    }
  }, [
    isRunAfterSingleRun,
    runningStatus,
    flowId,
    id,
    store,
    appendNodeInspectVars,
    updateNodeInspectRunningState,
    invalidLastRun,
    isStartNode,
    isTriggerNode,
    invalidateSysVarValues,
    invalidateConversationVarValues,
  ])

  const { handleNodeDataUpdate }: { handleNodeDataUpdate: (data: any) => void } = useNodeDataUpdate()
  const setNodeRunning = () => {
    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _singleRunningStatus: NodeRunningStatus.Running,
      },
    })
  }

  const cancelWebhookSingleRun = useCallback(() => {
    webhookSingleRunActiveRef.current = false
    webhookSingleRunTokenRef.current += 1
    if (webhookSingleRunAbortRef.current)
      webhookSingleRunAbortRef.current.abort()
    webhookSingleRunAbortRef.current = null
    if (webhookSingleRunTimeoutRef.current !== undefined) {
      window.clearTimeout(webhookSingleRunTimeoutRef.current)
      webhookSingleRunTimeoutRef.current = undefined
    }
    if (webhookSingleRunDelayResolveRef.current) {
      webhookSingleRunDelayResolveRef.current()
      webhookSingleRunDelayResolveRef.current = null
    }
  }, [])

  const cancelPluginSingleRun = useCallback(() => {
    pluginSingleRunActiveRef.current = false
    pluginSingleRunTokenRef.current += 1
    if (pluginSingleRunAbortRef.current)
      pluginSingleRunAbortRef.current.abort()
    pluginSingleRunAbortRef.current = null
    if (pluginSingleRunTimeoutRef.current !== undefined) {
      window.clearTimeout(pluginSingleRunTimeoutRef.current)
      pluginSingleRunTimeoutRef.current = undefined
    }
    if (pluginSingleRunDelayResolveRef.current) {
      pluginSingleRunDelayResolveRef.current()
      pluginSingleRunDelayResolveRef.current = null
    }
  }, [])

  const startTriggerListening = useCallback(() => {
    if (!isTriggerNode)
      return

    setIsListening(true)
    setShowVariableInspectPanel(true)
    setListeningTriggerType(data.type as TriggerNodeType)
    setListeningTriggerNodeId(id)
    setListeningTriggerNodeIds([id])
    setListeningTriggerIsAll(false)
  }, [
    isTriggerNode,
    setIsListening,
    setShowVariableInspectPanel,
    setListeningTriggerType,
    data.type,
    setListeningTriggerNodeId,
    id,
    setListeningTriggerNodeIds,
    setListeningTriggerIsAll,
  ])

  const stopTriggerListening = useCallback(() => {
    if (!isTriggerNode)
      return

    setIsListening(false)
    setListeningTriggerType(null)
    setListeningTriggerNodeId(null)
    setListeningTriggerNodeIds([])
    setListeningTriggerIsAll(false)
  }, [
    isTriggerNode,
    setIsListening,
    setListeningTriggerType,
    setListeningTriggerNodeId,
    setListeningTriggerNodeIds,
    setListeningTriggerIsAll,
  ])

  const runScheduleSingleRun = useCallback(async (): Promise<NodeRunResult | null> => {
    const urlPath = `/apps/${flowId}/workflows/draft/nodes/${id}/trigger/run`

    try {
      const response: any = await post(urlPath, {
        body: JSON.stringify({}),
      })

      if (!response) {
        const message = 'Schedule trigger run failed'
        Toast.notify({ type: 'error', message })
        throw new Error(message)
      }

      if (response?.status === 'error') {
        const message = response?.message || 'Schedule trigger run failed'
        Toast.notify({ type: 'error', message })
        throw new Error(message)
      }

      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _isSingleRun: false,
          _singleRunningStatus: NodeRunningStatus.Succeeded,
        },
      })

      return response as NodeRunResult
    }
    catch (error) {
      console.error('handleRun: schedule trigger single run error', error)
      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _isSingleRun: false,
          _singleRunningStatus: NodeRunningStatus.Failed,
        },
      })
      Toast.notify({ type: 'error', message: 'Schedule trigger run failed' })
      throw error
    }
  }, [flowId, id, handleNodeDataUpdate, data])

  const runWebhookSingleRun = useCallback(async (): Promise<any | null> => {
    const urlPath = `/apps/${flowId}/workflows/draft/nodes/${id}/trigger/run`

    webhookSingleRunActiveRef.current = true
    const token = ++webhookSingleRunTokenRef.current

    while (webhookSingleRunActiveRef.current && token === webhookSingleRunTokenRef.current) {
      const controller = new AbortController()
      webhookSingleRunAbortRef.current = controller

      try {
        const response: any = await post(urlPath, {
          body: JSON.stringify({}),
          signal: controller.signal,
        })

        if (!webhookSingleRunActiveRef.current || token !== webhookSingleRunTokenRef.current)
          return null

        if (!response) {
          const message = response?.message || 'Webhook debug failed'
          Toast.notify({ type: 'error', message })
          cancelWebhookSingleRun()
          throw new Error(message)
        }

        if (response?.status === 'waiting') {
          const delay = Number(response.retry_in) || 2000
          webhookSingleRunAbortRef.current = null
          if (!webhookSingleRunActiveRef.current || token !== webhookSingleRunTokenRef.current)
            return null

          await new Promise<void>((resolve) => {
            const timeoutId = window.setTimeout(resolve, delay)
            webhookSingleRunTimeoutRef.current = timeoutId
            webhookSingleRunDelayResolveRef.current = resolve
            controller.signal.addEventListener('abort', () => {
              window.clearTimeout(timeoutId)
              resolve()
            }, { once: true })
          })

          webhookSingleRunTimeoutRef.current = undefined
          webhookSingleRunDelayResolveRef.current = null
          continue
        }

        if (response?.status === 'error') {
          const message = response.message || 'Webhook debug failed'
          Toast.notify({ type: 'error', message })
          cancelWebhookSingleRun()
          throw new Error(message)
        }

        handleNodeDataUpdate({
          id,
          data: {
            ...data,
            _isSingleRun: false,
            _singleRunningStatus: NodeRunningStatus.Listening,
          },
        })

        cancelWebhookSingleRun()
        return response
      }
      catch (error) {
        if (controller.signal.aborted && (!webhookSingleRunActiveRef.current || token !== webhookSingleRunTokenRef.current))
          return null
        if (controller.signal.aborted)
          return null

        Toast.notify({ type: 'error', message: 'Webhook debug request failed' })
        cancelWebhookSingleRun()
        if (error instanceof Error)
          throw error
        throw new Error(String(error))
      }
      finally {
        webhookSingleRunAbortRef.current = null
      }
    }

    return null
  }, [flowId, id, data, handleNodeDataUpdate, cancelWebhookSingleRun])

  const runPluginSingleRun = useCallback(async (): Promise<any | null> => {
    const urlPath = `/apps/${flowId}/workflows/draft/nodes/${id}/trigger/run`

    pluginSingleRunActiveRef.current = true
    const token = ++pluginSingleRunTokenRef.current

    while (pluginSingleRunActiveRef.current && token === pluginSingleRunTokenRef.current) {
      const controller = new AbortController()
      pluginSingleRunAbortRef.current = controller

      let requestError: RequestError | undefined
      const response: any = await post(urlPath, {
        body: JSON.stringify({}),
        signal: controller.signal,
      }).catch(async (error: Response) => {
        const data = await error.clone().json() as Record<string, any>
        const { error: respError, status } = data || {}
        requestError = {
          message: respError,
          status,
        }
        return null
      }).finally(() => {
        pluginSingleRunAbortRef.current = null
      })

      if (!pluginSingleRunActiveRef.current || token !== pluginSingleRunTokenRef.current)
        return null

      if (requestError) {
        if (controller.signal.aborted)
          return null

        Toast.notify({ type: 'error', message: requestError.message })
        cancelPluginSingleRun()
        throw requestError
      }

      if (!response) {
        const message = 'Plugin debug failed'
        Toast.notify({ type: 'error', message })
        cancelPluginSingleRun()
        throw new Error(message)
      }

      if (response?.status === 'waiting') {
        const delay = Number(response.retry_in) || 2000
        if (!pluginSingleRunActiveRef.current || token !== pluginSingleRunTokenRef.current)
          return null

        await new Promise<void>((resolve) => {
          const timeoutId = window.setTimeout(resolve, delay)
          pluginSingleRunTimeoutRef.current = timeoutId
          pluginSingleRunDelayResolveRef.current = resolve
          controller.signal.addEventListener('abort', () => {
            window.clearTimeout(timeoutId)
            resolve()
          }, { once: true })
        })

        pluginSingleRunTimeoutRef.current = undefined
        pluginSingleRunDelayResolveRef.current = null
        continue
      }

      if (response?.status === 'error') {
        const message = response.message || 'Plugin debug failed'
        Toast.notify({ type: 'error', message })
        cancelPluginSingleRun()
        throw new Error(message)
      }

      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _isSingleRun: false,
          _singleRunningStatus: NodeRunningStatus.Listening,
        },
      })

      cancelPluginSingleRun()
      return response
    }

    return null
  }, [flowId, id, data, handleNodeDataUpdate, cancelPluginSingleRun])

  const checkValidWrap = () => {
    if (!checkValid)
      return { isValid: true, errorMessage: '' }
    const res = checkValid(data, t, moreDataForCheckValid)
    if (!res.isValid) {
      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _isSingleRun: false,
        },
      })
      Toast.notify({
        type: 'error',
        message: res.errorMessage || '',
      })
    }
    return res
  }
  const [canShowSingleRun, setCanShowSingleRun] = useState(false)
  const isShowSingleRun = data._isSingleRun && canShowSingleRun
  const [iterationRunResult, setIterationRunResult] = useState<NodeTracing[]>([])
  const [loopRunResult, setLoopRunResult] = useState<NodeTracing[]>([])

  useEffect(() => {
    if (!checkValid) {
      setCanShowSingleRun(true)
      return
    }

    if (data._isSingleRun) {
      const { isValid } = checkValidWrap()
      setCanShowSingleRun(isValid)
    }
  }, [data._isSingleRun])

  useEffect(() => {
    setShowSingleRunPanel(!!isShowSingleRun)
  }, [isShowSingleRun, setShowSingleRunPanel])

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
  const isCompleted = runningStatus === NodeRunningStatus.Succeeded || runningStatus === NodeRunningStatus.Failed

  const handleRun = async (submitData: Record<string, any>) => {
    if (isWebhookTriggerNode)
      cancelWebhookSingleRun()
    if (isPluginTriggerNode)
      cancelPluginSingleRun()

    updateNodeInspectRunningState(id, true)

    if (isTriggerNode)
      startTriggerListening()
    else
      stopTriggerListening()

    handleNodeDataUpdate({
      id,
      data: {
        ...data,
        _isSingleRun: false,
        _singleRunningStatus: isTriggerNode
          ? NodeRunningStatus.Listening
          : NodeRunningStatus.Running,
      },
    })
    let res: any
    let hasError = false
    try {
      if (!isIteration && !isLoop) {
        if (isScheduleTriggerNode) {
          res = await runScheduleSingleRun()
        }
        else if (isWebhookTriggerNode) {
          res = await runWebhookSingleRun()
          if (!res) {
            if (webhookSingleRunActiveRef.current) {
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _isSingleRun: false,
                  _singleRunningStatus: NodeRunningStatus.Stopped,
                },
              })
            }
            return false
          }
        }
        else if (isPluginTriggerNode) {
          res = await runPluginSingleRun()
          if (!res) {
            if (pluginSingleRunActiveRef.current) {
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _isSingleRun: false,
                  _singleRunningStatus: NodeRunningStatus.Stopped,
                },
              })
            }
            return false
          }
        }
        else {
          const isStartNode = data.type === BlockEnum.Start
          const postData: Record<string, any> = {}
          if (isStartNode) {
            const { '#sys.query#': query, '#sys.files#': files, ...inputs } = submitData
            if (isChatMode)
              postData.conversation_id = ''

            postData.inputs = inputs
            postData.query = query
            postData.files = files || []
          }
          else {
            postData.inputs = submitData
          }
          res = await singleNodeRun(flowType, flowId!, id, postData) as any
        }
      }
      else if (isIteration) {
        setIterationRunResult([])
        let _iterationResult: NodeTracing[] = []
        let _runResult: any = null
        ssePost(
          getIterationSingleNodeRunUrl(flowType, isChatMode, flowId!, id),
          { body: { inputs: submitData } },
          {
            onWorkflowStarted: noop,
            onWorkflowFinished: (params) => {
              if (isPausedRef.current)
                return
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _isSingleRun: false,
                  _singleRunningStatus: NodeRunningStatus.Succeeded,
                },
              })
              const { data: iterationData } = params
              _runResult.created_by = iterationData.created_by.name
              setRunResult(_runResult)
            },
            onIterationStart: (params) => {
              const newIterationRunResult = produce(_iterationResult, (draft) => {
                draft.push({
                  ...params.data,
                  status: NodeRunningStatus.Running,
                })
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onIterationNext: () => {
              // iteration next trigger time is triggered one more time than iterationTimes
              if (_iterationResult.length >= iterationTimes!)
                return _iterationResult.length >= iterationTimes!
            },
            onIterationFinish: (params) => {
              _runResult = params.data
              setRunResult(_runResult)
              const iterationRunResult = _iterationResult
              const currentIndex = iterationRunResult.findIndex(trace => trace.id === params.data.id)
              const newIterationRunResult = produce(iterationRunResult, (draft) => {
                if (currentIndex > -1) {
                  draft[currentIndex] = {
                    ...draft[currentIndex],
                    ...data,
                  }
                }
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onNodeStarted: (params) => {
              const newIterationRunResult = produce(_iterationResult, (draft) => {
                draft.push({
                  ...params.data,
                  status: NodeRunningStatus.Running,
                })
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onNodeFinished: (params) => {
              const iterationRunResult = _iterationResult

              const { data } = params
              const currentIndex = iterationRunResult.findIndex(trace => trace.id === data.id)
              const newIterationRunResult = produce(iterationRunResult, (draft) => {
                if (currentIndex > -1) {
                  draft[currentIndex] = {
                    ...draft[currentIndex],
                    ...data,
                  }
                }
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onNodeRetry: (params) => {
              const newIterationRunResult = produce(_iterationResult, (draft) => {
                draft.push(params.data)
              })
              _iterationResult = newIterationRunResult
              setIterationRunResult(newIterationRunResult)
            },
            onError: () => {
              if (isPausedRef.current)
                return
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _isSingleRun: false,
                  _singleRunningStatus: NodeRunningStatus.Failed,
                },
              })
            },
          },
        )
      }
      else if (isLoop) {
        setLoopRunResult([])
        let _loopResult: NodeTracing[] = []
        let _runResult: any = null
        ssePost(
          getLoopSingleNodeRunUrl(flowType, isChatMode, flowId!, id),
          { body: { inputs: submitData } },
          {
            onWorkflowStarted: noop,
            onWorkflowFinished: (params) => {
              if (isPausedRef.current)
                return
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _isSingleRun: false,
                  _singleRunningStatus: NodeRunningStatus.Succeeded,
                },
              })
              const { data: loopData } = params
              _runResult.created_by = loopData.created_by.name
              setRunResult(_runResult)
            },
            onLoopStart: (params) => {
              const newLoopRunResult = produce(_loopResult, (draft) => {
                draft.push({
                  ...params.data,
                  status: NodeRunningStatus.Running,
                })
              })
              _loopResult = newLoopRunResult
              setLoopRunResult(newLoopRunResult)
            },
            onLoopNext: () => {
              // loop next trigger time is triggered one more time than loopTimes
              if (_loopResult.length >= loopTimes!)
                return _loopResult.length >= loopTimes!
            },
            onLoopFinish: (params) => {
              _runResult = params.data
              setRunResult(_runResult)

              const loopRunResult = _loopResult
              const currentIndex = loopRunResult.findIndex(trace => trace.id === params.data.id)
              const newLoopRunResult = produce(loopRunResult, (draft) => {
                if (currentIndex > -1) {
                  draft[currentIndex] = {
                    ...draft[currentIndex],
                    ...data,
                  }
                }
              })
              _loopResult = newLoopRunResult
              setLoopRunResult(newLoopRunResult)
            },
            onNodeStarted: (params) => {
              const newLoopRunResult = produce(_loopResult, (draft) => {
                draft.push({
                  ...params.data,
                  status: NodeRunningStatus.Running,
                })
              })
              _loopResult = newLoopRunResult
              setLoopRunResult(newLoopRunResult)
            },
            onNodeFinished: (params) => {
              const loopRunResult = _loopResult

              const { data } = params
              const currentIndex = loopRunResult.findIndex(trace => trace.id === data.id)
              const newLoopRunResult = produce(loopRunResult, (draft) => {
                if (currentIndex > -1) {
                  draft[currentIndex] = {
                    ...draft[currentIndex],
                    ...data,
                  }
                }
              })
              _loopResult = newLoopRunResult
              setLoopRunResult(newLoopRunResult)
            },
            onNodeRetry: (params) => {
              const newLoopRunResult = produce(_loopResult, (draft) => {
                draft.push(params.data)
              })
              _loopResult = newLoopRunResult
              setLoopRunResult(newLoopRunResult)
            },
            onError: () => {
              if (isPausedRef.current)
                return
              handleNodeDataUpdate({
                id,
                data: {
                  ...data,
                  _isSingleRun: false,
                  _singleRunningStatus: NodeRunningStatus.Failed,
                },
              })
              trackEvent('workflow_run_failed', { workflow_id: flowId, node_id: id, reason: res.error, node_type: data?.type })
            },
          },
        )
      }
      if (res && res.error)
        throw new Error(res.error)
    }
    catch (e: any) {
      console.error(e)
      hasError = true
      invalidLastRun()
      if (!isIteration && !isLoop) {
        if (isPausedRef.current)
          return
        handleNodeDataUpdate({
          id,
          data: {
            ...data,
            _isSingleRun: false,
            _singleRunningStatus: NodeRunningStatus.Failed,
          },
        })
        return false
      }
    }
    finally {
      if (isWebhookTriggerNode)
        cancelWebhookSingleRun()
      if (isPluginTriggerNode)
        cancelPluginSingleRun()
      if (isTriggerNode)
        stopTriggerListening()
      if (!isIteration && !isLoop)
        updateNodeInspectRunningState(id, false)
      if (!isPausedRef.current && !isIteration && !isLoop && res) {
        setRunResult({
          ...res,
          total_tokens: res.execution_metadata?.total_tokens || 0,
          created_by: res.created_by_account?.name || '',
        })
      }
    }
    if (isPausedRef.current)
      return

    if (!isIteration && !isLoop && !hasError) {
      if (isPausedRef.current)
        return
      handleNodeDataUpdate({
        id,
        data: {
          ...data,
          _isSingleRun: false,
          _singleRunningStatus: NodeRunningStatus.Succeeded,
        },
      })
    }
  }

  const handleStop = useCallback(() => {
    if (isTriggerNode) {
      const isTriggerActive = runningStatus === NodeRunningStatus.Listening
        || webhookSingleRunActiveRef.current
        || pluginSingleRunActiveRef.current
      if (!isTriggerActive)
        return
    }
    else if (runningStatus !== NodeRunningStatus.Running) {
      return
    }

    cancelWebhookSingleRun()
    cancelPluginSingleRun()
    handleNodeDataUpdate({
      id,
      data: {
        _isSingleRun: false,
        _singleRunningStatus: NodeRunningStatus.Stopped,
      },
    })
    stopTriggerListening()
    updateNodeInspectRunningState(id, false)
    const {
      workflowRunningData,
      setWorkflowRunningData,
      nodesWithInspectVars,
      deleteNodeInspectVars,
    } = workflowStore.getState()
    if (workflowRunningData) {
      setWorkflowRunningData(produce(workflowRunningData, (draft) => {
        draft.result.status = WorkflowRunningStatus.Stopped
      }))
    }

    const inspectNode = nodesWithInspectVars.find(node => node.nodeId === id)
    if (inspectNode && !inspectNode.isValueFetched && (!inspectNode.vars || inspectNode.vars.length === 0))
      deleteNodeInspectVars(id)
  }, [
    isTriggerNode,
    runningStatus,
    cancelWebhookSingleRun,
    cancelPluginSingleRun,
    handleNodeDataUpdate,
    id,
    stopTriggerListening,
    updateNodeInspectRunningState,
    workflowStore,
  ])

  const toVarInputs = (variables: Variable[]): InputVar[] => {
    if (!variables)
      return []

    const varInputs = variables.filter(item => !isENV(item.value_selector)).map((item) => {
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
        label: (typeof item.label === 'object' ? item.label.variable : item.label) || item.variable,
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
          isChatVar: isConversationVar(item),
        },
        variable: `#${item.join('.')}#`,
        value_selector: item,
      }
    })

    const varInputs = toVarInputs(variables)
    return varInputs
  }

  const varSelectorsToVarInputs = (valueSelectors: ValueSelector[] | string[]): InputVar[] => {
    return valueSelectors.filter(item => !!item).map((item) => {
      return getInputVars([`{{#${typeof item === 'string' ? item : item.join('.')}#}}`])[0]
    })
  }

  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP)
      handleStop()
  })

  return {
    isShowSingleRun,
    hideSingleRun,
    showSingleRun,
    toVarInputs,
    varSelectorsToVarInputs,
    getInputVars,
    runningStatus,
    isCompleted,
    handleRun,
    handleStop,
    runInputData,
    runInputDataRef,
    setRunInputData: handleSetRunInputData,
    runResult,
    setRunResult: doSetRunResult,
    iterationRunResult,
    loopRunResult,
    setNodeRunning,
    checkValid: checkValidWrap,
  }
}

export default useOneStepRun
