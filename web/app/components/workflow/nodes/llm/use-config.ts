import { useCallback } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import { type Memory, PromptRole, type ValueSelector } from '../../types'
import type { LLMNodeType } from './types'
import { Resolution } from '@/types/app'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import type { PromptItem } from '@/models/debug'
import { RETRIEVAL_OUTPUT_STRUCT } from '@/app/components/workflow/constants'

const useConfig = (id: string, payload: LLMNodeType) => {
  const { inputs, setInputs } = useNodeCrud<LLMNodeType>(id, payload)

  // model
  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === 'chat'
  const isCompletionModel = !isChatModel

  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
      const isModeChange = model.mode !== inputs.model.mode
      if (isModeChange)
        draft.prompt_template = model.mode === 'chat' ? [{ role: PromptRole.system, text: '' }] : { text: '' }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const {
    currentModel: currModel,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    {
      provider: model.provider,
      model: model.name,
    },
  )
  const isShowVisionConfig = !!currModel?.features?.includes(ModelFeatureEnum.vision)

  // variables
  const { handleVarListChange, handleAddVariable } = useVarList<LLMNodeType>({
    inputs,
    setInputs,
  })

  // context
  const handleContextVarChange = useCallback((newVar: ValueSelector) => {
    const newInputs = produce(inputs, (draft) => {
      draft.context.variable_selector = newVar
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handlePromptChange = useCallback((newPrompt: PromptItem[] | PromptItem) => {
    const newInputs = produce(inputs, (draft) => {
      draft.prompt_template = newPrompt
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleMemoryChange = useCallback((newMemory: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = newMemory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleVisionResolutionChange = useCallback((newResolution: Resolution) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.vision.configs) {
        draft.vision.configs = {
          detail: Resolution.high,
        }
      }
      draft.vision.configs.detail = newResolution
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<LLMNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      '#context#': [RETRIEVAL_OUTPUT_STRUCT],
      '#vision#': [],
    },
  })

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .filter(key => !['#context#', '#vision#'].includes(key))
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    const newVars = {
      ...newPayload,
      '#context#': runInputData['#context#'],
      '#vision#': runInputData['#vision#'],
    }
    setRunInputData(newVars)
  }, [runInputData, setRunInputData])

  const contexts = runInputData['#context#']
  const setContexts = useCallback((newContexts: string[]) => {
    setRunInputData({
      ...runInputData,
      '#context#': newContexts,
    })
  }, [runInputData, setRunInputData])

  const visionFiles = runInputData['#vision']
  const setVisionFiles = useCallback((newFiles: any[]) => {
    setRunInputData({
      ...runInputData,
      '#vision#': newFiles,
    })
  }, [runInputData, setRunInputData])

  const varInputs = toVarInputs(inputs.variables)

  return {
    inputs,
    isChatModel,
    isCompletionModel,
    isShowVisionConfig,
    handleModelChanged,
    handleCompletionParamsChange,
    handleVarListChange,
    handleAddVariable,
    handleContextVarChange,
    handlePromptChange,
    handleMemoryChange,
    handleVisionResolutionChange,
    isShowSingleRun,
    hideSingleRun,
    inputVarValues,
    setInputVarValues,
    visionFiles,
    setVisionFiles,
    contexts,
    setContexts,
    varInputs,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
  }
}

export default useConfig
