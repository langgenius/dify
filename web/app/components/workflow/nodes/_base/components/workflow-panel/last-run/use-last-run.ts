import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import type { Params as OneStepRunParams } from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { useCallback, useState } from 'react'
import { TabType } from '../tab'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import useStartSingleRunFormParams from '@/app/components/workflow/nodes/start/use-single-run-form-params'
import useLLMSingleRunFormParams from '@/app/components/workflow/nodes/llm/use-single-run-form-params'
import useKnowledgeRetrievalSingleRunFormParams from '@/app/components/workflow/nodes/knowledge-retrieval/use-single-run-form-params'
import useCodeSingleRunFormParams from '@/app/components/workflow/nodes/code/use-single-run-form-params'
import useTemplateTransformSingleRunFormParams from '@/app/components/workflow/nodes/template-transform/use-single-run-form-params'
import useQuestionClassifierSingleRunFormParams from '@/app/components/workflow/nodes/question-classifier/use-single-run-form-params'
import useParameterExtractorSingleRunFormParams from '@/app/components/workflow/nodes/parameter-extractor/use-single-run-form-params'
import useHttpRequestSingleRunFormParams from '@/app/components/workflow/nodes/http/use-single-run-form-params'
import useToolSingleRunFormParams from '@/app/components/workflow/nodes/tool/use-single-run-form-params'
import useIterationSingleRunFormParams from '@/app/components/workflow/nodes/iteration/use-single-run-form-params'
import useAgentSingleRunFormParams from '@/app/components/workflow/nodes/agent/use-single-run-form-params'
import useDocExtractorSingleRunFormParams from '@/app/components/workflow/nodes/document-extractor/use-single-run-form-params'
import useLoopSingleRunFormParams from '@/app/components/workflow/nodes/loop/use-single-run-form-params'
import useIfElseSingleRunFormParams from '@/app/components/workflow/nodes/if-else/use-single-run-form-params'
import useVariableAggregatorSingleRunFormParams from '@/app/components/workflow/nodes/variable-assigner/use-single-run-form-params'
import useToolGetDataForCheckMore from '@/app/components/workflow/nodes/tool/use-get-data-for-check-more'

// import
import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'

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
  [BlockEnum.End]: undefined,
  [BlockEnum.Answer]: undefined,
  [BlockEnum.VariableAssigner]: undefined,
  [BlockEnum.ListFilter]: undefined,
  [BlockEnum.IterationStart]: undefined,
  [BlockEnum.Assigner]: undefined,
  [BlockEnum.LoopStart]: undefined,
  [BlockEnum.LoopEnd]: undefined,
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

type Params<T> = OneStepRunParams<T>
const useLastRun = <T>({
  ...oneStepRunParams
}: Params<T>) => {
  const { conversationVars, systemVars, hasSetInspectVar } = useInspectVarsCrud()
  const blockType = oneStepRunParams.data.type
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    getData: getDataForCheckMore,
  } = useGetDataForCheckMoreHooks<T>(blockType)(oneStepRunParams.id, oneStepRunParams.data)
  const {
    id,
    data,
  } = oneStepRunParams
  const oneStepRunRes = useOneStepRun({
    ...oneStepRunParams,
    iteratorInputKey: blockType === BlockEnum.Iteration ? `${id}.input_selector` : '',
    moreDataForCheckValid: getDataForCheckMore(),
  })

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
  } = oneStepRunRes

  const {
    nodeInfo,
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

  const callRunApi = async (data: Record<string, any>) => {
    await handleSyncWorkflowDraft(true)
    doCallRunApi(data)
  }

  const [tabType, setTabType] = useState<TabType>(TabType.settings)
  const handleRunWithParams = async (data: Record<string, any>) => {
    setTabType(TabType.lastRun)
    callRunApi(data)
    hideSingleRun()
  }

  const handleTabClicked = useCallback((type: TabType) => {
    setTabType(type)
  }, [])

  const getExistVarValuesInForms = (forms: FormProps[]) => {
    if (!forms || forms.length === 0)
      return []

    const valuesArr = forms.map((form) => {
      const values: Record<string, boolean> = {}
      form.inputs.forEach(({ variable }) => {
        if(!variable.includes('.') && !singleRunParams?.getDependentVar)
          return

        const selector = !variable.includes('.') ? singleRunParams?.getDependentVar(variable) : variable.slice(1, -1).split('.')
        const [nodeId, varName] = selector.slice(0, 2)
        const inspectVarValue = hasSetInspectVar(nodeId, varName, systemVars, conversationVars) // also detect system var , env and  conversation var
        if (inspectVarValue)
          values[variable] = true
      })
      return values
    })
    return valuesArr
  }

  const isAllVarsHasValue = (vars?: ValueSelector[]) => {
    if(!vars || vars.length === 0)
      return true
    return vars.every((varItem) => {
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

  const handleSingleRun = () => {
    // no need to input params
    if (isAllVarsHasValue(singleRunParams?.getDependentVars?.())) {
      callRunApi({})
      setTabType(TabType.lastRun)
    }
    else {
      showSingleRun()
    }
  }

  return {
    ...oneStepRunRes,
    tabType,
    setTabType: handleTabClicked,
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
