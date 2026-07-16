import type { LLMDefaultConfig } from './hooks/use-llm-input-manager'
import type { LLMNodeType } from './types'
import type { EnvironmentVariable, ValueSelector } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback, useEffect, useState } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { AppModeEnum } from '@/types/app'
import { useIsChatMode, useNodesReadOnly } from '../../hooks'
import useConfigVision from '../../hooks/use-config-vision'
import { useStore } from '../../store'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useLLMInputManager from './hooks/use-llm-input-manager'
import useLLMPromptConfig from './hooks/use-llm-prompt-config'
import useLLMStructuredOutputConfig from './hooks/use-llm-structured-output-config'
import {
  isEnvironmentModelSource as getIsEnvironmentModelSource,
  getLLMEnvironmentModel,
  resolveLLMNodeModel,
} from './utils'

const EMPTY_ENVIRONMENT_VARIABLES: EnvironmentVariable[] = []

const useConfig = (id: string, payload: LLMNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const defaultConfig = useStore((s) => s.nodesDefaultConfigs)?.[payload.type] as
    | LLMDefaultConfig
    | undefined
  const environmentVariables =
    useStore((s) => s.environmentVariables) ?? EMPTY_ENVIRONMENT_VARIABLES
  const { inputs, setInputs: doSetInputs } = useNodeCrud<LLMNodeType>(id, payload)
  const isEnvironmentModelSource = getIsEnvironmentModelSource(inputs.model_selector)
  const resolvedModel = resolveLLMNodeModel(
    inputs.model,
    inputs.model_selector,
    environmentVariables,
  )
  const model = resolvedModel ?? {
    ...inputs.model,
    provider: '',
    name: '',
  }
  const modelMode = model.mode
  const isChatModel = modelMode === AppModeEnum.CHAT
  const isCompletionModel = !isChatModel

  const { inputRef, setInputs, appendDefaultPromptConfig } = useLLMInputManager({
    inputs,
    doSetInputs,
    defaultConfig,
    isChatModel,
  })

  const { deleteNodeInspectorVars } = useInspectVarsCrud()

  const [modelChanged, setModelChanged] = useState(false)
  const { currentProvider, currentModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.textGeneration,
  )

  const {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleModelChanged: handleVisionConfigAfterModelChanged,
  } = useConfigVision(model, {
    payload: inputs.vision,
    onChange: (newPayload) => {
      const newInputs = produce(inputRef.current, (draft) => {
        draft.vision = newPayload
      })
      setInputs(newInputs)
    },
  })

  const applyModelIdentity = useCallback(
    (
      model: { provider: string; modelId: string; mode?: string },
      modelSelector?: ValueSelector,
      completionParams?: LLMNodeType['model']['completion_params'],
    ) => {
      const nextInputs = produce(inputRef.current, (draft) => {
        draft.model.provider = model.provider
        draft.model.name = model.modelId
        draft.model.mode = model.mode!
        if (completionParams !== undefined) draft.model.completion_params = completionParams
        draft.model_selector = modelSelector
        const isModeChange = model.mode !== inputRef.current.model.mode
        if (isModeChange && defaultConfig && Object.keys(defaultConfig).length > 0)
          appendDefaultPromptConfig(draft, defaultConfig, model.mode === AppModeEnum.CHAT)
      })
      setInputs(nextInputs)
      setModelChanged(true)
    },
    [setInputs, defaultConfig, appendDefaultPromptConfig, inputRef],
  )

  const handleModelChanged = useCallback(
    (
      model: { provider: string; modelId: string; mode?: string },
      completionParams?: LLMNodeType['model']['completion_params'],
    ) => {
      applyModelIdentity(model, undefined, completionParams)
    },
    [applyModelIdentity],
  )

  const handleModelSourceChange = useCallback(
    (useEnvironmentVariable: boolean) => {
      const nextInputs = produce(inputRef.current, (draft) => {
        if (useEnvironmentVariable) draft.model_selector = []
        else {
          const currentModel = resolveLLMNodeModel(
            inputRef.current.model,
            inputRef.current.model_selector,
            environmentVariables,
          )
          if (currentModel) {
            draft.model.provider = currentModel.provider
            draft.model.name = currentModel.name
            draft.model.mode = currentModel.mode
            draft.model.completion_params = currentModel.completion_params
          }
          draft.model_selector = undefined
        }
      })
      setInputs(nextInputs)
    },
    [environmentVariables, inputRef, setInputs],
  )

  const handleModelSelectorChange = useCallback(
    (
      modelSelector: ValueSelector,
      completionParams?: LLMNodeType['model']['completion_params'],
    ) => {
      const selectedModel = getLLMEnvironmentModel(modelSelector, environmentVariables)
      if (!selectedModel) {
        const nextInputs = produce(inputRef.current, (draft) => {
          draft.model_selector = modelSelector
        })
        setInputs(nextInputs)
        return
      }

      applyModelIdentity(
        {
          provider: selectedModel.provider,
          modelId: selectedModel.name,
          mode: selectedModel.mode,
        },
        modelSelector,
        selectedModel.completion_params ?? completionParams,
      )
    },
    [applyModelIdentity, environmentVariables, inputRef, setInputs],
  )

  useEffect(() => {
    if (
      !isEnvironmentModelSource &&
      currentProvider?.provider &&
      currentModel?.model &&
      !model.provider
    ) {
      handleModelChanged({
        provider: currentProvider?.provider,
        modelId: currentModel?.model,
        mode: currentModel?.model_properties?.mode as string,
      })
    }
  }, [model.provider, currentProvider, currentModel, handleModelChanged, isEnvironmentModelSource])

  const handleCompletionParamsChange = useCallback(
    (newParams: LLMNodeType['model']['completion_params']) => {
      const newInputs = produce(inputRef.current, (draft) => {
        draft.model.completion_params = newParams
      })
      setInputs(newInputs)
    },
    [inputRef, setInputs],
  )

  // change to vision model to set vision enabled, else disabled
  useEffect(() => {
    if (!modelChanged) return
    setModelChanged(false)
    handleVisionConfigAfterModelChanged()
  }, [handleVisionConfigAfterModelChanged, isVisionModel, modelChanged])
  const promptConfig = useLLMPromptConfig({
    inputs,
    inputRef,
    isChatMode,
    isChatModel,
    setInputs,
  })

  const structuredOutputConfig = useLLMStructuredOutputConfig({
    id,
    model,
    inputRef,
    setInputs,
    deleteNodeInspectorVars,
  })

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: promptConfig.filterVar,
  })

  return {
    readOnly,
    isChatMode,
    inputs,
    model,
    environmentVariables,
    isEnvironmentModelSource,
    isChatModel,
    isCompletionModel,
    hasSetBlockStatus: promptConfig.hasSetBlockStatus,
    shouldShowContextTip: promptConfig.shouldShowContextTip,
    isVisionModel,
    handleModelChanged,
    handleModelSourceChange,
    handleModelSelectorChange,
    handleCompletionParamsChange,
    isShowVars: promptConfig.isShowVars,
    handleVarListChange: promptConfig.handleVarListChange,
    handleVarNameChange: promptConfig.handleVarNameChange,
    handleAddVariable: promptConfig.handleAddVariable,
    handleAddEmptyVariable: promptConfig.handleAddEmptyVariable,
    handleContextVarChange: promptConfig.handleContextVarChange,
    filterInputVar: promptConfig.filterInputVar,
    filterVar: promptConfig.filterVar,
    availableVars,
    availableNodesWithParent,
    handlePromptChange: promptConfig.handlePromptChange,
    handleMemoryChange: promptConfig.handleMemoryChange,
    handleSyeQueryChange: promptConfig.handleSyeQueryChange,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    isModelSupportStructuredOutput: structuredOutputConfig.isModelSupportStructuredOutput,
    handleStructureOutputChange: structuredOutputConfig.handleStructureOutputChange,
    structuredOutputCollapsed: structuredOutputConfig.structuredOutputCollapsed,
    setStructuredOutputCollapsed: structuredOutputConfig.setStructuredOutputCollapsed,
    handleStructureOutputEnableChange: structuredOutputConfig.handleStructureOutputEnableChange,
    filterJinja2InputVar: promptConfig.filterJinja2InputVar,
    handleReasoningFormatChange: structuredOutputConfig.handleReasoningFormatChange,
  }
}

export default useConfig
