import type { Props as FormProps } from '../../../../../nodes/_base/components/before-run-form/form'
import type { Params as OneStepRunParams } from '../../../../../nodes/_base/hooks/use-one-step-run'
// import
import type { CommonNodeType, ValueSelector } from '../../../../../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useEffect, useState } from 'react'
import {
  useNodesSyncDraft,
} from '../../../../../hooks'
import { useWorkflowRunValidation } from '../../../../../hooks/use-checklist'
import useInspectVarsCrud from '../../../../../hooks/use-inspect-vars-crud'
import useOneStepRun from '../../../../../nodes/_base/hooks/use-one-step-run'
import useAgentSingleRunFormParams from '../../../../../nodes/agent/use-single-run-form-params'
import useVariableAssignerSingleRunFormParams from '../../../../../nodes/assigner/use-single-run-form-params'
import useCodeSingleRunFormParams from '../../../../../nodes/code/use-single-run-form-params'
import useDocExtractorSingleRunFormParams from '../../../../../nodes/document-extractor/use-single-run-form-params'
import useHttpRequestSingleRunFormParams from '../../../../../nodes/http/use-single-run-form-params'
import useHumanInputSingleRunFormParams from '../../../../../nodes/human-input/hooks/use-single-run-form-params'
import useIfElseSingleRunFormParams from '../../../../../nodes/if-else/use-single-run-form-params'
import useIterationSingleRunFormParams from '../../../../../nodes/iteration/use-single-run-form-params'
import useKnowledgeBaseSingleRunFormParams from '../../../../../nodes/knowledge-base/use-single-run-form-params'
import useKnowledgeRetrievalSingleRunFormParams from '../../../../../nodes/knowledge-retrieval/use-single-run-form-params'
import useLLMSingleRunFormParams from '../../../../../nodes/llm/use-single-run-form-params'
import useLoopSingleRunFormParams from '../../../../../nodes/loop/use-single-run-form-params'
import useParameterExtractorSingleRunFormParams from '../../../../../nodes/parameter-extractor/use-single-run-form-params'

import useQuestionClassifierSingleRunFormParams from '../../../../../nodes/question-classifier/use-single-run-form-params'
import useStartSingleRunFormParams from '../../../../../nodes/start/use-single-run-form-params'
import useTemplateTransformSingleRunFormParams from '../../../../../nodes/template-transform/use-single-run-form-params'

import useToolGetDataForCheckMore from '../../../../../nodes/tool/hooks/use-get-data-for-check-more'
import useToolSingleRunFormParams from '../../../../../nodes/tool/hooks/use-single-run-form-params'
import useTriggerPluginGetDataForCheckMore from '../../../../../nodes/trigger-plugin/use-check-params'
import useVariableAggregatorSingleRunFormParams from '../../../../../nodes/variable-assigner/use-single-run-form-params'

import { useStore, useWorkflowStore } from '../../../../../store'
import { BlockEnum } from '../../../../../types'
import { isSupportCustomRunForm } from '../../../../../utils'
import { VALUE_SELECTOR_DELIMITER as DELIMITER } from '@/config'
import { useInvalidLastRun } from '@/service/use-workflow'
import { TabType } from '../../../../../nodes/_base/components/workflow-panel/tab'

const singleRunFormParamsHooks: Record<BlockEnum, any> = {
  [BlockEnum.LLM]: useLLMSingleRunFormParams,
  [BlockEnum.KnowledgeRetrieval]: useKnowledgeRetrievalSingleRunFormParams,
  [BlockEnum.Code]: useCodeSingleRunFormParams,
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
  [BlockEnum.TriggerWebhook]: undefined,
  [BlockEnum.TriggerSchedule]: undefined,
  [BlockEnum.TriggerPlugin]: useTriggerPluginGetDataForCheckMore,
}

const useGetDataForCheckMoreHooks = <T>(nodeType: BlockEnum) => {
  return (id: string, payload: CommonNodeType<T>) => {
    return getDataForCheckMoreHooks[nodeType]?.({ id, payload }) || {
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
  const { conversationVars, systemVars, hasSetInspectVar } = useInspectVarsCrud()
  const blockType = oneStepRunParams.data.type
  const isStartNode = blockType === BlockEnum.Start
  const isIterationNode = blockType === BlockEnum.Iteration
  const isLoopNode = blockType === BlockEnum.Loop
  const isAggregatorNode = blockType === BlockEnum.VariableAggregator
  const isCustomRunNode = isSupportCustomRunForm(blockType)
  const isHumanInputNode = blockType === BlockEnum.HumanInput
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    getData: getDataForCheckMore,
  } = useGetDataForCheckMoreHooks<T>(blockType)(oneStepRunParams.id, oneStepRunParams.data)
  const [isRunAfterSingleRun, setIsRunAfterSingleRun] = useState(false)

  const {
    id,
    flowId,
    flowType,
    data,
  } = oneStepRunParams
  const oneStepRunRes = useOneStepRun({
    ...oneStepRunParams,
    iteratorInputKey: blockType === BlockEnum.Iteration ? `${id}.input_selector` : '',
    moreDataForCheckValid: getDataForCheckMore(),
    isRunAfterSingleRun,
  })

  const { warningNodes } = useWorkflowRunValidation()
  const blockIfChecklistFailed = useCallback(() => {
    const warningForNode = warningNodes.find(item => item.id === id)
    if (!warningForNode)
      return false

    if (warningForNode.unConnected && warningForNode.errorMessages.length === 0)
      return false

    const message = warningForNode.errorMessages[0] || 'This node has unresolved checklist issues'
    toast.error(message)
    return true
  }, [warningNodes, id])

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
    id,
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
      formattedData[`${nodeId}.${allVarObject[key].inSingleRunPassedKey}`] = data[varSectorStr!]
    })
    if (isIterationNode) {
      const iteratorInputKey = `${id}.input_selector`
      formattedData[iteratorInputKey] = data[iteratorInputKey]
    }
    return formattedData
  }, [isIterationNode, isLoopNode, singleRunParams?.allVarObject, id])

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
  const [tabType, setTabType] = useState<TabType>(initShowLastRunTab ? TabType.lastRun : TabType.settings)
  useEffect(() => {
    if (initShowLastRunTab)
      setTabType(TabType.lastRun)

    setInitShowLastRunTab(false)
  }, [initShowLastRunTab])
  const invalidLastRun = useInvalidLastRun(flowType, flowId, id)

  const handleRunWithParams = async (data: Record<string, any>) => {
    if (blockIfChecklistFailed())
      return
    const { isValid } = checkValid()
    if (!isValid)
      return
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
        if (!isStartNode && nodeId === id) { // inner vars like loop vars
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
      const inspectVarValue = hasSetInspectVar(nodeId!, varName!, systemVars, conversationVars) // also detect system var , env and  conversation var
      return inspectVarValue
    })
  }

  const isSomeVarsHasValue = (vars?: ValueSelector[]) => {
    if (!vars || vars.length === 0)
      return true
    return vars.some((varItem) => {
      const [nodeId, varName] = varItem.slice(0, 2)
      const inspectVarValue = hasSetInspectVar(nodeId!, varName!, systemVars, conversationVars) // also detect system var , env and  conversation var
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
        return !(input.variable in existVarValuesInForm!)
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
    if (blockType === BlockEnum.TriggerWebhook || blockType === BlockEnum.TriggerPlugin || blockType === BlockEnum.TriggerSchedule)
      setShowVariableInspectPanel(true)
    if (isCustomRunNode || isHumanInputNode) {
      showSingleRun()
      return
    }
    const vars = singleRunParams?.getDependentVars?.()
    // no need to input params
    if (isAggregatorNode ? checkAggregatorVarsSet(vars) : isAllVarsHasValue(vars)) {
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
