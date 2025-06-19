import { useCallback, useEffect, useRef, useState } from 'react'
import produce from 'immer'
import type { Memory, MoreInfo, ValueSelector, Var } from '../../types'
import { ChangeType, VarType } from '../../types'
import { useStore } from '../../store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import useOneStepRun from '../_base/hooks/use-one-step-run'
import useConfigVision from '../../hooks/use-config-vision'
import type { Param, ParameterExtractorNodeType, ReasoningModeType } from './types'
import { useModelListAndDefaultModelAndCurrentProviderAndModel, useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { supportFunctionCall } from '@/utils/tool-call'
import { mergeValidCompletionParams } from '@/utils/completion-params'
import { fetchModelParameterRules } from '@/service/common'
import Toast from '@/app/components/base/toast'

const useConfig = (id: string, payload: ParameterExtractorNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleOutVarRenameChange } = useWorkflow()
  const isChatMode = useIsChatMode()

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)[payload.type]

  const [defaultRolePrefix, setDefaultRolePrefix] = useState<{ user: string; assistant: string }>({ user: '', assistant: '' })
  const { inputs, setInputs: doSetInputs } = useNodeCrud<ParameterExtractorNodeType>(id, payload)
  const inputRef = useRef(inputs)

  const setInputs = useCallback((newInputs: ParameterExtractorNodeType) => {
    if (newInputs.memory && !newInputs.memory.role_prefix) {
      const newPayload = produce(newInputs, (draft) => {
        draft.memory!.role_prefix = defaultRolePrefix
      })
      doSetInputs(newPayload)
      inputRef.current = newPayload
      return
    }
    doSetInputs(newInputs)
    inputRef.current = newInputs
  }, [doSetInputs, defaultRolePrefix])

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.string].includes(varPayload.type)
  }, [])

  const handleInputVarChange = useCallback((newInputVar: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query = newInputVar as ValueSelector || []
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleExactParamsChange = useCallback((newParams: Param[], moreInfo?: MoreInfo) => {
    const newInputs = produce(inputs, (draft) => {
      draft.parameters = newParams
    })
    setInputs(newInputs)

    if (moreInfo && moreInfo?.type === ChangeType.changeVarName && moreInfo.payload)
      handleOutVarRenameChange(id, [id, moreInfo.payload.beforeKey], [id, moreInfo.payload.afterKey!])
  }, [handleOutVarRenameChange, id, inputs, setInputs])

  const addExtractParameter = useCallback((payload: Param) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.parameters)
        draft.parameters = []
      draft.parameters.push(payload)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // model
  const model = inputs.model || {
    provider: '',
    name: '',
    mode: 'chat',
    completion_params: {
      temperature: 0.7,
    },
  }
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === 'chat'
  const isCompletionModel = !isChatModel

  const {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleModelChanged: handleVisionConfigAfterModelChanged,
  } = useConfigVision(model, {
    payload: inputs.vision,
    onChange: (newPayload) => {
      const newInputs = produce(inputs, (draft) => {
        draft.vision = newPayload
      })
      setInputs(newInputs)
    },
  })

  const appendDefaultPromptConfig = useCallback((draft: ParameterExtractorNodeType, defaultConfig: any, _passInIsChatMode?: boolean) => {
    const promptTemplates = defaultConfig.prompt_templates
    if (!isChatModel) {
      setDefaultRolePrefix({
        user: promptTemplates.completion_model.conversation_histories_role.user_prefix,
        assistant: promptTemplates.completion_model.conversation_histories_role.assistant_prefix,
      })
    }
  }, [isChatModel])

  const [modelChanged, setModelChanged] = useState(false)
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    (async () => {
      const newInputs = produce(inputRef.current, (draft) => {
        draft.model.provider = model.provider
        draft.model.name = model.modelId
        draft.model.mode = model.mode!
        const isModeChange = model.mode !== inputRef.current.model?.mode
        if (isModeChange && defaultConfig && Object.keys(defaultConfig).length > 0)
          appendDefaultPromptConfig(draft, defaultConfig, model.mode === 'chat')
      })

      // filter completion params
      try {
        const url = `/workspaces/current/model-providers/${model.provider}/models/parameter-rules?model=${model.modelId}`
        const { data: parameterRules } = await fetchModelParameterRules(url)
        const { params: filtered, removedDetails } = mergeValidCompletionParams(inputRef.current.model.completion_params, parameterRules ?? [])
        if (Object.keys(removedDetails).length)
          Toast.notify({ type: 'warning', message: `${t('common.modelProvider.parametersInvalidRemoved')}: ` + Object.entries(removedDetails).map(([k, reason]) => `${k} (${reason})`).join(', ') })
        newInputs.model.completion_params = filtered
      }
      catch {
        // ignore errors
      }
      setInputs(newInputs)
      setModelChanged(true)
    })()
  }, [setInputs, defaultConfig, appendDefaultPromptConfig])

  useEffect(() => {
    if (currentProvider?.provider && currentModel?.model && !model.provider) {
      handleModelChanged({
        provider: currentProvider?.provider,
        modelId: currentModel?.model,
        mode: currentModel?.model_properties?.mode as string,
      })
    }
  }, [model?.provider, currentProvider, currentModel, handleModelChanged])

  // change to vision model to set vision enabled, else disabled
  useEffect(() => {
    if (!modelChanged)
      return
    setModelChanged(false)
    handleVisionConfigAfterModelChanged()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisionModel, modelChanged])

  const {
    currentModel: currModel,
  } = useTextGenerationCurrentProviderAndModelAndModelList(
    {
      provider: model.provider,
      model: model.name,
    },
  )

  const isSupportFunctionCall = supportFunctionCall(currModel?.features)

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.number, VarType.string].includes(varPayload.type)
  }, [])

  const filterVisionInputVar = useCallback((varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterInputVar,
  })

  const {
    availableVars: availableVisionVars,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterVisionInputVar,
  })

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleInstructionChange = useCallback((newInstruction: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.instruction = newInstruction
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const hasSetBlockStatus = {
    history: false,
    query: isChatMode ? checkHasQueryBlock(inputs.instruction) : false,
    context: false,
  }

  const handleMemoryChange = useCallback((newMemory?: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = newMemory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleReasoningModeChange = useCallback((newReasoningMode: ReasoningModeType) => {
    const newInputs = produce(inputs, (draft) => {
      draft.reasoning_mode = newReasoningMode
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleImportFromTool = useCallback((params: Param[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.parameters = params
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    getInputVars,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    runInputDataRef,
    setRunInputData,
    runResult,
  } = useOneStepRun<ParameterExtractorNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      'query': '',
      '#files#': [],
    },
  })

  const varInputs = getInputVars([inputs.instruction])
  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    setRunInputData(newPayload)
  }, [setRunInputData])

  const visionFiles = runInputData['#files#']
  const setVisionFiles = useCallback((newFiles: any[]) => {
    setRunInputData({
      ...runInputDataRef.current,
      '#files#': newFiles,
    })
  }, [runInputDataRef, setRunInputData])

  return {
    readOnly,
    handleInputVarChange,
    filterVar,
    isChatMode,
    inputs,
    isChatModel,
    isCompletionModel,
    handleModelChanged,
    handleCompletionParamsChange,
    handleImportFromTool,
    handleExactParamsChange,
    addExtractParameter,
    handleInstructionChange,
    hasSetBlockStatus,
    availableVars,
    availableNodesWithParent,
    availableVisionVars,
    isSupportFunctionCall,
    handleReasoningModeChange,
    handleMemoryChange,
    varInputs,
    inputVarValues,
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    setInputVarValues,
    visionFiles,
    setVisionFiles,
  }
}

export default useConfig
