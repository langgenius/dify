import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import type { Params as OneStepRunParams } from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { useCallback, useState } from 'react'
import { TabType } from '../tab'
import { useWorkflowStore } from '@/app/components/workflow/store'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import useStartSingleRunFormParams from '@/app/components/workflow/nodes/start/use-single-run-form-params'
import useLLMSingleRunFormParams from '@/app/components/workflow/nodes/llm/use-single-run-form-params'
import useKnowledgeRetrievalSingleRunFormParams from '@/app/components/workflow/nodes/knowledge-retrieval/use-single-run-form-params'
import useCodeSingleRunFormParams from '@/app/components/workflow/nodes/code/use-single-run-form-params'
import useTemplateTransformSingleRunFormParams from '@/app/components/workflow/nodes/template-transform/use-single-run-form-params'
import useQuestionClassifierSingleRunFormParams from '@/app/components/workflow/nodes/question-classifier/use-single-run-form-params'
import useParameterExtractorSingleRunFormParams from '@/app/components/workflow/nodes/parameter-extractor/use-single-run-form-params'
import useHttpRequestSingleRunFormParams from '@/app/components/workflow/nodes/http/use-single-run-form-params'
import useIterationSingleRunFormParams from '@/app/components/workflow/nodes/iteration/use-single-run-form-params'
import useDocExtractorSingleRunFormParams from '@/app/components/workflow/nodes/document-extractor/use-single-run-form-params'
import useLoopSingleRunFormParams from '@/app/components/workflow/nodes/loop/use-single-run-form-params'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'

const singleRunFormParamsHooks: Record<BlockEnum, any> = {
  [BlockEnum.LLM]: useLLMSingleRunFormParams,
  [BlockEnum.KnowledgeRetrieval]: useKnowledgeRetrievalSingleRunFormParams,
  [BlockEnum.Code]: useCodeSingleRunFormParams,
  [BlockEnum.TemplateTransform]: useTemplateTransformSingleRunFormParams,
  [BlockEnum.QuestionClassifier]: useQuestionClassifierSingleRunFormParams,
  [BlockEnum.HttpRequest]: useHttpRequestSingleRunFormParams,
  [BlockEnum.Tool]: undefined,
  [BlockEnum.ParameterExtractor]: useParameterExtractorSingleRunFormParams,
  [BlockEnum.Iteration]: useIterationSingleRunFormParams,
  [BlockEnum.Agent]: undefined,
  [BlockEnum.DocExtractor]: useDocExtractorSingleRunFormParams,
  [BlockEnum.Loop]: useLoopSingleRunFormParams,
  [BlockEnum.Start]: useStartSingleRunFormParams,
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

const useSingleRunFormParamsHooks = (nodeType: BlockEnum) => {
  return (params: any) => {
    return singleRunFormParamsHooks[nodeType]?.(params) || {}
  }
}

type Params<T> = OneStepRunParams<T>
const useLastRun = <T>({
  ...oneStepRunParams
}: Params<T>) => {
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const {
    id,
    data,
  } = oneStepRunParams
  const oneStepRunRes = useOneStepRun(oneStepRunParams)
  const {
    hideSingleRun,
    handleRun: doCallRunApi,
    getInputVars,
    toVarInputs,
    runInputData,
    runInputDataRef,
    setRunInputData,
    showSingleRun,
  } = oneStepRunRes

  const singleRunParams = useSingleRunFormParamsHooks(data.type)({
    id,
    payload: data,
    runInputData,
    runInputDataRef,
    getInputVars,
    setRunInputData,
    toVarInputs,
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
  const hasLastRunData = true // TODO: add disabled logic

  const workflowStore = useWorkflowStore()
  const {
    getInspectVar,
  } = workflowStore.getState()
  const getExistVarValuesInForms = (forms: FormProps[]) => {
    if (!forms || forms.length === 0)
      return []

    // if (!singleRunParams)
    const valuesArr = forms.map((form) => {
      const values: Record<string, any> = {}
      form.inputs.forEach(({ variable }) => {
        // #nodeId.path1?.path2?...# => [nodeId, path1]
        // TODO: conversation vars and envs
        const selector = variable.slice(1, -1).split('.')
        const [nodeId, varName] = selector.slice(0, 2)
        const inspectVarValue = getInspectVar(nodeId, varName)
        if (inspectVarValue !== undefined) {
          const subPathArr = selector.slice(2)
          if (subPathArr.length > 0) {
            let current = inspectVarValue.value
            let invalid = false
            subPathArr.forEach((subPath) => {
              if (invalid)
                return

              if (current && typeof current === 'object' && subPath in current) {
                current = current[subPath]
                return
              }
              invalid = true
            })
            values[variable] = current
          }
          else {
            values[variable] = inspectVarValue
          }
        }
      })
      return values
    })
    return valuesArr
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
    const filteredExistVarForms = getFilteredExistVarForms(singleRunParams.forms)
    if (filteredExistVarForms.length > 0)
      showSingleRun()
    else
      callRunApi({})// no need to pass params
  }

  return {
    ...oneStepRunRes,
    tabType,
    setTabType: handleTabClicked,
    singleRunParams,
    setRunInputData,
    hasLastRunData,
    handleSingleRun,
    handleRunWithParams,
    getExistVarValuesInForms,
    getFilteredExistVarForms,
  }
}

export default useLastRun
