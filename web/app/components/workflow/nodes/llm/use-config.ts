import type { LLMDefaultConfig } from './hooks/use-llm-input-manager'
import type { LLMNodeType } from './types'
import { produce } from 'immer'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { AppModeEnum } from '@/types/app'
import {
  useIsChatMode,
  useNodesReadOnly,
} from '../../hooks'
import useConfigVision from '../../hooks/use-config-vision'
import { useStore } from '../../store'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useLLMInputManager from './hooks/use-llm-input-manager'
import useLLMPromptConfig from './hooks/use-llm-prompt-config'
import useLLMStructuredOutputConfig from './hooks/use-llm-structured-output-config'

const useConfig = (id: string, payload: LLMNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)?.[payload.type] as LLMDefaultConfig | undefined
  const { inputs, setInputs: doSetInputs } = useNodeCrud<LLMNodeType>(id, payload)
  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === AppModeEnum.CHAT
  const isCompletionModel = !isChatModel

  const {
    inputRef,
    setInputs,
    appendDefaultPromptConfig,
  } = useLLMInputManager({
    inputs,
    doSetInputs,
    defaultConfig,
    isChatModel,
  })

  const { deleteNodeInspectorVars } = useInspectVarsCrud()

  const [modelChanged, setModelChanged] = useState(false)
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

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

  const handleModelChanged = useCallback((model: { provider: string, modelId: string, mode?: string }) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
      const isModeChange = model.mode !== inputRef.current.model.mode
      if (isModeChange && defaultConfig && Object.keys(defaultConfig).length > 0)
        appendDefaultPromptConfig(draft, defaultConfig, model.mode === AppModeEnum.CHAT)
    })
    setInputs(nextInputs)
    setModelChanged(true)
  }, [setInputs, defaultConfig, appendDefaultPromptConfig])

  useEffect(() => {
    if (currentProvider?.provider && currentModel?.model && !model.provider) {
      handleModelChanged({
        provider: currentProvider?.provider,
        modelId: currentModel?.model,
        mode: currentModel?.model_properties?.mode as string,
      })
    }
  }, [model.provider, currentProvider, currentModel, handleModelChanged])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [setInputs])

  // change to vision model to set vision enabled, else disabled
  useEffect(() => {
    if (!modelChanged)
      return
    setModelChanged(false)
    handleVisionConfigAfterModelChanged()
  }, [isVisionModel, modelChanged])
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

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: promptConfig.filterVar,
  })

  return {
    readOnly,
    isChatMode,
    inputs,
    isChatModel,
    isCompletionModel,
    hasSetBlockStatus: promptConfig.hasSetBlockStatus,
    shouldShowContextTip: promptConfig.shouldShowContextTip,
    isVisionModel,
    handleModelChanged,
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
