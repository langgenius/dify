import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { Params as OneStepRunParams } from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
// import
import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import Toast from '@/app/components/base/toast'
import {
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import { useWorkflowRunValidation } from '@/app/components/workflow/hooks/use-checklist'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import {
  useSubGraphVariablesCheck,
} from '@/app/components/workflow/nodes/_base/components/workflow-panel/last-run/sub-graph-variables-check'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import useAgentSingleRunFormParams from '@/app/components/workflow/nodes/agent/use-single-run-form-params'
import useVariableAssignerSingleRunFormParams from '@/app/components/workflow/nodes/assigner/use-single-run-form-params'
import useCodeSingleRunFormParams from '@/app/components/workflow/nodes/code/use-single-run-form-params'
import useDocExtractorSingleRunFormParams from '@/app/components/workflow/nodes/document-extractor/use-single-run-form-params'
import useFileUploadSingleRunFormParams from '@/app/components/workflow/nodes/file-upload/use-single-run-form-params'
import useHttpRequestSingleRunFormParams from '@/app/components/workflow/nodes/http/use-single-run-form-params'
import useHumanInputSingleRunFormParams from '@/app/components/workflow/nodes/human-input/hooks/use-single-run-form-params'
import useIfElseSingleRunFormParams from '@/app/components/workflow/nodes/if-else/use-single-run-form-params'
import useIterationSingleRunFormParams from '@/app/components/workflow/nodes/iteration/use-single-run-form-params'
import useKnowledgeBaseSingleRunFormParams from '@/app/components/workflow/nodes/knowledge-base/use-single-run-form-params'
import useKnowledgeRetrievalSingleRunFormParams from '@/app/components/workflow/nodes/knowledge-retrieval/use-single-run-form-params'
import useLLMSingleRunFormParams from '@/app/components/workflow/nodes/llm/use-single-run-form-params'
import useLoopSingleRunFormParams from '@/app/components/workflow/nodes/loop/use-single-run-form-params'
import useParameterExtractorSingleRunFormParams from '@/app/components/workflow/nodes/parameter-extractor/use-single-run-form-params'

import useQuestionClassifierSingleRunFormParams from '@/app/components/workflow/nodes/question-classifier/use-single-run-form-params'
import useStartSingleRunFormParams from '@/app/components/workflow/nodes/start/use-single-run-form-params'
import useTemplateTransformSingleRunFormParams from '@/app/components/workflow/nodes/template-transform/use-single-run-form-params'

import useToolGetDataForCheckMore from '@/app/components/workflow/nodes/tool/use-get-data-for-check-more'
import useToolSingleRunFormParams from '@/app/components/workflow/nodes/tool/use-single-run-form-params'
import useTriggerPluginGetDataForCheckMore from '@/app/components/workflow/nodes/trigger-plugin/use-check-params'
import useVariableAggregatorSingleRunFormParams from '@/app/components/workflow/nodes/variable-assigner/use-single-run-form-params'

import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum, isPromptMessageContext } from '@/app/components/workflow/types'
import { isSupportCustomRunForm } from '@/app/components/workflow/utils'
import { VALUE_SELECTOR_DELIMITER as DELIMITER } from '@/config'
import { useInvalidLastRun } from '@/service/use-workflow'
import { TabType } from '../tab'

const singleRunFormParamsHooks: Record<BlockEnum, any> = {
  [BlockEnum.LLM]: useLLMSingleRunFormParams,
  [BlockEnum.KnowledgeRetrieval]: useKnowledgeRetrievalSingleRunFormParams,
  [BlockEnum.Code]: useCodeSingleRunFormParams,
  [BlockEnum.Command]: undefined,
  [BlockEnum.FileUpload]: useFileUploadSingleRunFormParams,
  [BlockEnum.TemplateTransform]: useTemplateTransformSingleRunFormParams,
  [BlockEnum.QuestionClassifier]: useQuestionClassifierSingleRunFormParams,
  [BlockEnum.HttpRequest]: useHttpRequestSingleRunFormParams,
  [BlockEnum.Tool]: useToolSingleRunFormParams,
  [BlockEnum.ParameterExtractor]: useParameterExtractorSingleRunFormParams,
  [BlockEnum.Iteration]: useIterationSingleRunFormParams,
  [BlockEnum.Agent]: useAgentSingleRunFormParams,
  [BlockEnum.DocExtractor]: useDocExtractorSingleRunFormParams,
  [BlockEnum.Loop]: useLoopSingleRunFormParams,
  [BlockEnum.Start]: useStartSingleRunFormParams,
  [BlockEnum.IfElse]: useIfElseSingleRunFormParams,
  [BlockEnum.VariableAggregator]: useVariableAggregatorSingleRunFormParams,
  [BlockEnum.Assigner]: useVariableAssignerSingleRunFormParams,
  [BlockEnum.KnowledgeBase]: useKnowledgeBaseSingleRunFormParams,
  [BlockEnum.Group]: undefined,
  [BlockEnum.VariableAssigner]: undefined,
  [BlockEnum.End]: undefined,
  [BlockEnum.Answer]: undefined,
  [BlockEnum.ListFilter]: undefined,
  [BlockEnum.IterationStart]: undefined,
  [BlockEnum.LoopStart]: undefined,
  [BlockEnum.LoopEnd]: undefined,
  [BlockEnum.HumanInput]: useHumanInputSingleRunFormParams,
  [BlockEnum.DataSource]: undefined,
  [BlockEnum.DataSourceEmpty]: undefined,
  [BlockEnum.TriggerWebhook]: undefined,
  [BlockEnum.TriggerSchedule]: undefined,
  [BlockEnum.TriggerPlugin]: undefined,
}

const useSingleRunFormParamsHooks = (nodeType: BlockEnum) => {
  return (params: any) => {
    return singleRunFormParamsHooks[nodeType]?.(params) || {}
  }
}

const getDataForCheckMoreHooks: Record<BlockEnum, any> = {
  [BlockEnum.Tool]: useToolGetDataForCheckMore,
  [BlockEnum.LLM]: undefined,
  [BlockEnum.KnowledgeRetrieval]: undefined,
  [BlockEnum.Code]: undefined,
  [BlockEnum.Command]: undefined,
  [BlockEnum.FileUpload]: undefined,
  [BlockEnum.TemplateTransform]: undefined,
  [BlockEnum.QuestionClassifier]: undefined,
  [BlockEnum.HttpRequest]: undefined,
  [BlockEnum.ParameterExtractor]: undefined,
  [BlockEnum.Iteration]: undefined,
  [BlockEnum.Agent]: undefined,
  [BlockEnum.DocExtractor]: undefined,
  [BlockEnum.Loop]: undefined,
  [BlockEnum.Start]: undefined,
  [BlockEnum.IfElse]: undefined,
  [BlockEnum.VariableAggregator]: undefined,
  [BlockEnum.End]: undefined,
  [BlockEnum.Answer]: undefined,
  [BlockEnum.VariableAssigner]: undefined,
  [BlockEnum.ListFilter]: undefined,
  [BlockEnum.IterationStart]: undefined,
  [BlockEnum.Assigner]: undefined,
  [BlockEnum.LoopStart]: undefined,
  [BlockEnum.LoopEnd]: undefined,
  [BlockEnum.HumanInput]: undefined,
  [BlockEnum.DataSource]: undefined,
  [BlockEnum.DataSourceEmpty]: undefined,
  [BlockEnum.KnowledgeBase]: undefined,
  [BlockEnum.Group]: undefined,
  [BlockEnum.TriggerWebhook]: undefined,
  [BlockEnum.TriggerSchedule]: undefined,
  [BlockEnum.TriggerPlugin]: useTriggerPluginGetDataForCheckMore,
}

const useGetDataForCheckMoreHooks = <T>(nodeType: BlockEnum) => {
  return (nodeId: string, payload: CommonNodeType<T>) => {
    return getDataForCheckMoreHooks[nodeType]?.({ id: nodeId, payload }) || {
      getData: () => {
        return {}
      },
    }
  }
}

type Params<T> = Omit<OneStepRunParams<T>, 'isRunAfterSingleRun'>
const useLastRun = <T>({
  ...oneStepRunParams
}: Params<T>) => {
  const currentNodeId = oneStepRunParams.id
  const flowId = oneStepRunParams.flowId
  const flowType = oneStepRunParams.flowType
  const data = oneStepRunParams.data
  const {
    conversationVars,
    systemVars,
    hasSetInspectVar,
    nodesWithInspectVars,
  } = useInspectVarsCrud()
  const { getNullDependentOutput } = useSubGraphVariablesCheck({
    currentNodeId,
    nodesWithInspectVars,
  })
  const { t } = useTranslation()
  const blockType = oneStepRunParams.data.type
  const isStartNode = blockType === BlockEnum.Start
  const isIterationNode = blockType === BlockEnum.Iteration
  const isLoopNode = blockType === BlockEnum.Loop
  const isAggregatorNode = blockType === BlockEnum.VariableAggregator
  const isCustomRunNode = isSupportCustomRunForm(blockType)
  const isHumanInputNode = blockType === BlockEnum.HumanInput
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const reactFlowStore = useStoreApi()
  const {
    getData: getDataForCheckMore,
  } = useGetDataForCheckMoreHooks<T>(blockType)(currentNodeId, oneStepRunParams.data)
  const [isRunAfterSingleRun, setIsRunAfterSingleRun] = useState(false)

  const oneStepRunRes = useOneStepRun({
    ...oneStepRunParams,
    iteratorInputKey: blockType === BlockEnum.Iteration ? `${currentNodeId}.input_selector` : '',
    moreDataForCheckValid: getDataForCheckMore(),
    isRunAfterSingleRun,
  })

  const { warningNodes } = useWorkflowRunValidation()
  const blockIfChecklistFailed = useCallback(() => {
    const warningForNode = warningNodes.find(item => item.id === currentNodeId)
    if (!warningForNode)
      return false

    if (warningForNode.unConnected && !warningForNode.errorMessage)
      return false

    const message = warningForNode.errorMessage || 'This node has unresolved checklist issues'
    Toast.notify({ type: 'error', message })
    return true
  }, [warningNodes, currentNodeId])

  const {
    hideSingleRun,
    handleRun: doCallRunApi,
    getInputVars,
    toVarInputs,
    varSelectorsToVarInputs,
    runInputData,
    runInputDataRef,
    setRunInputData,
    showSingleRun,
    runResult,
    iterationRunResult,
    loopRunResult,
    setNodeRunning,
    checkValid,
  } = oneStepRunRes

  const nodeInfo = runResult
  const {
    ...singleRunParams
  } = useSingleRunFormParamsHooks(blockType)({
    id: currentNodeId,
    payload: data,
    runInputData,
    runInputDataRef,
    getInputVars,
    setRunInputData,
    toVarInputs,
    varSelectorsToVarInputs,
    runResult,
    iterationRunResult,
    loopRunResult,
  })

  const toSubmitData = useCallback((data: Record<string, any>) => {
    if (!isIterationNode && !isLoopNode)
      return data

    const allVarObject = singleRunParams?.allVarObject || {}
    const formattedData: Record<string, any> = {}
    Object.keys(allVarObject).forEach((key) => {
      const [varSectorStr, nodeId] = key.split(DELIMITER)
      formattedData[`${nodeId}.${allVarObject[key].inSingleRunPassedKey}`] = data[varSectorStr]
    })
    if (isIterationNode) {
      const iteratorInputKey = `${currentNodeId}.input_selector`
      formattedData[iteratorInputKey] = data[iteratorInputKey]
    }
    return formattedData
  }, [isIterationNode, isLoopNode, singleRunParams?.allVarObject, currentNodeId])

  const callRunApi = (data: Record<string, any>, cb?: () => void) => {
    handleSyncWorkflowDraft(true, true, {
      onSuccess() {
        doCallRunApi(toSubmitData(data))
        cb?.()
      },
    })
  }
  const workflowStore = useWorkflowStore()
  const { setInitShowLastRunTab, setShowVariableInspectPanel } = workflowStore.getState()
  const initShowLastRunTab = useStore(s => s.initShowLastRunTab)
  const parentAvailableNodes = useStore(s => s.parentAvailableNodes) || []
  const [tabType, setTabType] = useState<TabType>(initShowLastRunTab ? TabType.lastRun : TabType.settings)
  useEffect(() => {
    if (initShowLastRunTab)
      setTabType(TabType.lastRun)

    setInitShowLastRunTab(false)
  }, [initShowLastRunTab])
  const invalidLastRun = useInvalidLastRun(flowType, flowId, currentNodeId)

  const getContextNodeLabel = useCallback((nodeId: string) => {
    const nodeInFlow = reactFlowStore.getState().getNodes().find(node => node.id === nodeId)
    const flowNodeTitle = nodeInFlow?.data?.title
    if (flowNodeTitle && flowNodeTitle !== nodeId)
      return flowNodeTitle
    const parentNode = parentAvailableNodes.find(node => node.id === nodeId)
    const parentNodeTitle = parentNode?.data?.title
    if (parentNodeTitle && parentNodeTitle !== nodeId)
      return parentNodeTitle
    return ''
  }, [parentAvailableNodes, reactFlowStore])

  const formatSubgraphOutputLabel = useCallback((selector: ValueSelector) => {
    const [nodeId, varName, ...restPath] = selector || []
    const nodeLabel = nodeId ? getContextNodeLabel(nodeId) : ''
    const outputPath = [varName, ...restPath].filter(Boolean).join('.')
    if (nodeLabel && outputPath)
      return `${nodeLabel}.${outputPath}`
    if (nodeLabel)
      return nodeLabel
    if (outputPath)
      return outputPath
    return t('nodes.llm.contextUnknownNode', { ns: 'workflow' })
  }, [getContextNodeLabel, t])

  const ensureLLMContextReady = useCallback(() => {
    if (blockType !== BlockEnum.LLM)
      return true
    const llmData = data as unknown as LLMNodeType
    const promptTemplate = llmData.prompt_template
    if (!Array.isArray(promptTemplate))
      return true
    const contextSelectors = promptTemplate
      .filter(isPromptMessageContext)
      .map(item => item.$context)
      .filter(selector => Array.isArray(selector) && selector.length >= 2)
    if (contextSelectors.length === 0)
      return true
    const uniqueSelectors = new Set(contextSelectors.map(selector => `${selector[0]}::${selector[1]}`))
    for (const selectorKey of uniqueSelectors) {
      const [nodeId, varName] = selectorKey.split('::')
      const inspectVarValue = hasSetInspectVar(nodeId, varName, systemVars, conversationVars)
      if (!inspectVarValue) {
        const nodeLabel = getContextNodeLabel(nodeId)
          || t('nodes.llm.contextUnknownNode', { ns: 'workflow' })
        Toast.notify({
          type: 'error',
          message: t('nodes.llm.contextMissing', {
            ns: 'workflow',
            nodeName: nodeLabel,
          }),
        })
        return false
      }
    }
    return true
  }, [blockType, data, t, hasSetInspectVar, systemVars, conversationVars, getContextNodeLabel])

  const handleRunWithParams = async (data: Record<string, any>) => {
    if (blockIfChecklistFailed())
      return
    const { isValid } = checkValid()
    if (!isValid)
      return
    if (!ensureLLMContextReady())
      return
    const dependentVars = singleRunParams?.getDependentVars?.()
    const nullOutput = getNullDependentOutput(dependentVars)
    if (nullOutput) {
      Toast.notify({
        type: 'error',
        message: t('singleRun.subgraph.nullOutputError', {
          ns: 'workflow',
          output: formatSubgraphOutputLabel(nullOutput),
        }),
      })
      return
    }
    setNodeRunning()
    setIsRunAfterSingleRun(true)
    setTabType(TabType.lastRun)
    callRunApi(data, () => {
      invalidLastRun()
    })
    hideSingleRun()
  }

  const handleTabClicked = useCallback((type: TabType) => {
    setIsRunAfterSingleRun(false)
    setTabType(type)
  }, [])

  const getExistVarValuesInForms = (forms: FormProps[]) => {
    if (!forms || forms.length === 0)
      return []

    const valuesArr = forms.map((form) => {
      const values: Record<string, boolean> = {}
      form.inputs.forEach(({ variable, getVarValueFromDependent }) => {
        const isGetValueFromDependent = getVarValueFromDependent || !variable.includes('.')
        if (isGetValueFromDependent && !singleRunParams?.getDependentVar)
          return

        const selector = isGetValueFromDependent ? (singleRunParams?.getDependentVar(variable) || []) : variable.slice(1, -1).split('.')
        if (!selector || selector.length === 0)
          return
        const [nodeId, varName] = selector.slice(0, 2)
        if (!isStartNode && nodeId === currentNodeId) { // inner vars like loop vars
          values[variable] = true
          return
        }
        const inspectVarValue = hasSetInspectVar(nodeId, varName, systemVars, conversationVars) // also detect system var , env and  conversation var
        if (inspectVarValue)
          values[variable] = true
      })
      return values
    })
    return valuesArr
  }

  const isAllVarsHasValue = (vars?: ValueSelector[]) => {
    if (!vars || vars.length === 0)
      return true
    return vars.every((varItem) => {
      const [nodeId, varName] = varItem.slice(0, 2)
      const inspectVarValue = hasSetInspectVar(nodeId, varName, systemVars, conversationVars) // also detect system var , env and  conversation var
      return inspectVarValue
    })
  }

  const isSomeVarsHasValue = (vars?: ValueSelector[]) => {
    if (!vars || vars.length === 0)
      return true
    return vars.some((varItem) => {
      const [nodeId, varName] = varItem.slice(0, 2)
      const inspectVarValue = hasSetInspectVar(nodeId, varName, systemVars, conversationVars) // also detect system var , env and  conversation var
      return inspectVarValue
    })
  }
  const getFilteredExistVarForms = (forms: FormProps[]) => {
    if (!forms || forms.length === 0)
      return []

    const existVarValuesInForms = getExistVarValuesInForms(forms)

    const res = forms.map((form, i) => {
      const existVarValuesInForm = existVarValuesInForms[i]
      const newForm = { ...form }
      const inputs = form.inputs.filter((input) => {
        return !(input.variable in existVarValuesInForm)
      })
      newForm.inputs = inputs
      return newForm
    }).filter(form => form.inputs.length > 0)
    return res
  }

  const checkAggregatorVarsSet = (vars: ValueSelector[][]) => {
    if (!vars || vars.length === 0)
      return true
    // in each group, at last one set is ok
    return vars.every((varItem) => {
      return isSomeVarsHasValue(varItem)
    })
  }

  const handleAfterCustomSingleRun = () => {
    invalidLastRun()
    setTabType(TabType.lastRun)
    hideSingleRun()
  }

  const handleSingleRun = () => {
    if (blockIfChecklistFailed())
      return
    const { isValid } = checkValid()
    if (!isValid)
      return
    if (!ensureLLMContextReady())
      return
    const dependentVars = singleRunParams?.getDependentVars?.()
    const nullOutput = getNullDependentOutput(dependentVars)
    if (nullOutput) {
      Toast.notify({
        type: 'error',
        message: t('singleRun.subgraph.nullOutputError', {
          ns: 'workflow',
          output: formatSubgraphOutputLabel(nullOutput),
        }),
      })
      return
    }
    if (blockType === BlockEnum.TriggerWebhook || blockType === BlockEnum.TriggerPlugin || blockType === BlockEnum.TriggerSchedule)
      setShowVariableInspectPanel(true)
    if (isCustomRunNode || isHumanInputNode) {
      showSingleRun()
      return
    }
    const vars = dependentVars
    const canDirectRun = isAggregatorNode ? checkAggregatorVarsSet(vars) : isAllVarsHasValue(vars)
    const singleRunForms = Array.isArray(singleRunParams?.forms) ? singleRunParams.forms as FormProps[] : []
    const canAutoRunWithFilteredForms = getFilteredExistVarForms(singleRunForms).length === 0
    // no need to input params
    if (canDirectRun || canAutoRunWithFilteredForms) {
      callRunApi({}, async () => {
        setIsRunAfterSingleRun(true)
        setNodeRunning()
        invalidLastRun()
        setTabType(TabType.lastRun)
      })
    }
    else {
      showSingleRun()
    }
  }

  return {
    ...oneStepRunRes,
    tabType,
    isRunAfterSingleRun,
    setIsRunAfterSingleRun,
    setTabType: handleTabClicked,
    handleAfterCustomSingleRun,
    singleRunParams,
    nodeInfo,
    setRunInputData,
    handleSingleRun,
    handleRunWithParams,
    getExistVarValuesInForms,
    getFilteredExistVarForms,
  }
}

export default useLastRun
