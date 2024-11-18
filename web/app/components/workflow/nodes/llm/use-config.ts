import { useCallback, useEffect, useRef, useState } from 'react'
import produce from 'immer'
import { EditionType, VarType } from '../../types'
import type { Memory, PromptItem, ValueSelector, Var, Variable } from '../../types'
import { useStore } from '../../store'
import {
  useIsChatMode,
  useNodesReadOnly,
} from '../../hooks'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useConfigVision from '../../hooks/use-config-vision'
import type { LLMNodeType } from './types'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { RETRIEVAL_OUTPUT_STRUCT } from '@/app/components/workflow/constants'
import { checkHasContextBlock, checkHasHistoryBlock, checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'

const useConfig = (id: string, payload: LLMNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)[payload.type]
  const [defaultRolePrefix, setDefaultRolePrefix] = useState<{ user: string; assistant: string }>({ user: '', assistant: '' })
  const { inputs, setInputs: doSetInputs } = useNodeCrud<LLMNodeType>(id, payload)
  const inputRef = useRef(inputs)

  const setInputs = useCallback((newInputs: LLMNodeType) => {
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

  // model
  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === 'chat'

  const isCompletionModel = !isChatModel

  const hasSetBlockStatus = (() => {
    const promptTemplate = inputs.prompt_template
    const hasSetContext = isChatModel ? (promptTemplate as PromptItem[]).some(item => checkHasContextBlock(item.text)) : checkHasContextBlock((promptTemplate as PromptItem).text)
    if (!isChatMode) {
      return {
        history: false,
        query: false,
        context: hasSetContext,
      }
    }
    if (isChatModel) {
      return {
        history: false,
        query: (promptTemplate as PromptItem[]).some(item => checkHasQueryBlock(item.text)),
        context: hasSetContext,
      }
    }
    else {
      return {
        history: checkHasHistoryBlock((promptTemplate as PromptItem).text),
        query: checkHasQueryBlock((promptTemplate as PromptItem).text),
        context: hasSetContext,
      }
    }
  })()

  const shouldShowContextTip = !hasSetBlockStatus.context && inputs.context.enabled

  const appendDefaultPromptConfig = useCallback((draft: LLMNodeType, defaultConfig: any, passInIsChatMode?: boolean) => {
    const promptTemplates = defaultConfig.prompt_templates
    if (passInIsChatMode === undefined ? isChatModel : passInIsChatMode) {
      draft.prompt_template = promptTemplates.chat_model.prompts
    }
    else {
      draft.prompt_template = promptTemplates.completion_model.prompt

      setDefaultRolePrefix({
        user: promptTemplates.completion_model.conversation_histories_role.user_prefix,
        assistant: promptTemplates.completion_model.conversation_histories_role.assistant_prefix,
      })
    }
  }, [isChatModel])
  useEffect(() => {
    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0

    if (isReady && !inputs.prompt_template) {
      const newInputs = produce(inputs, (draft) => {
        appendDefaultPromptConfig(draft, defaultConfig)
      })
      setInputs(newInputs)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultConfig, isChatModel])

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
      const newInputs = produce(inputs, (draft) => {
        draft.vision = newPayload
      })
      setInputs(newInputs)
    },
  })

  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
      const isModeChange = model.mode !== inputRef.current.model.mode
      if (isModeChange && defaultConfig && Object.keys(defaultConfig).length > 0)
        appendDefaultPromptConfig(draft, defaultConfig, model.mode === 'chat')
    })
    setInputs(newInputs)
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
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // change to vision model to set vision enabled, else disabled
  useEffect(() => {
    if (!modelChanged)
      return
    setModelChanged(false)
    handleVisionConfigAfterModelChanged()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisionModel, modelChanged])

  // variables
  const isShowVars = (() => {
    if (isChatModel)
      return (inputs.prompt_template as PromptItem[]).some(item => item.edition_type === EditionType.jinja2)

    return (inputs.prompt_template as PromptItem).edition_type === EditionType.jinja2
  })()
  const handleAddEmptyVariable = useCallback(() => {
    const newInputs = produce(inputRef.current, (draft) => {
      if (!draft.prompt_config) {
        draft.prompt_config = {
          jinja2_variables: [],
        }
      }
      if (!draft.prompt_config.jinja2_variables)
        draft.prompt_config.jinja2_variables = []

      draft.prompt_config.jinja2_variables.push({
        variable: '',
        value_selector: [],
      })
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleAddVariable = useCallback((payload: Variable) => {
    const newInputs = produce(inputRef.current, (draft) => {
      if (!draft.prompt_config) {
        draft.prompt_config = {
          jinja2_variables: [],
        }
      }
      if (!draft.prompt_config.jinja2_variables)
        draft.prompt_config.jinja2_variables = []

      draft.prompt_config.jinja2_variables.push(payload)
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleVarListChange = useCallback((newList: Variable[]) => {
    const newInputs = produce(inputRef.current, (draft) => {
      if (!draft.prompt_config) {
        draft.prompt_config = {
          jinja2_variables: [],
        }
      }
      if (!draft.prompt_config.jinja2_variables)
        draft.prompt_config.jinja2_variables = []

      draft.prompt_config.jinja2_variables = newList
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleVarNameChange = useCallback((oldName: string, newName: string) => {
    const newInputs = produce(inputRef.current, (draft) => {
      if (isChatModel) {
        const promptTemplate = draft.prompt_template as PromptItem[]
        promptTemplate.filter(item => item.edition_type === EditionType.jinja2).forEach((item) => {
          item.jinja2_text = (item.jinja2_text || '').replaceAll(`{{ ${oldName} }}`, `{{ ${newName} }}`)
        })
      }
      else {
        if ((draft.prompt_template as PromptItem).edition_type !== EditionType.jinja2)
          return

        const promptTemplate = draft.prompt_template as PromptItem
        promptTemplate.jinja2_text = (promptTemplate.jinja2_text || '').replaceAll(`{{ ${oldName} }}`, `{{ ${newName} }}`)
      }
    })
    setInputs(newInputs)
  }, [isChatModel, setInputs])

  // context
  const handleContextVarChange = useCallback((newVar: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.context.variable_selector = newVar as ValueSelector || []
      draft.context.enabled = !!(newVar && newVar.length > 0)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handlePromptChange = useCallback((newPrompt: PromptItem[] | PromptItem) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.prompt_template = newPrompt
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleMemoryChange = useCallback((newMemory?: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = newMemory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleSyeQueryChange = useCallback((newQuery: string) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.memory) {
        draft.memory = {
          window: {
            enabled: false,
            size: 10,
          },
          query_prompt_template: newQuery,
        }
      }
      else {
        draft.memory.query_prompt_template = newQuery
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.number, VarType.string, VarType.secret, VarType.arrayString, VarType.arrayNumber].includes(varPayload.type)
  }, [])

  const filterMemoryPromptVar = useCallback((varPayload: Var) => {
    return [VarType.arrayObject, VarType.array, VarType.number, VarType.string, VarType.secret, VarType.arrayString, VarType.arrayNumber].includes(varPayload.type)
  }, [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterMemoryPromptVar,
  })

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    getInputVars,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
    toVarInputs,
  } = useOneStepRun<LLMNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      '#context#': [RETRIEVAL_OUTPUT_STRUCT],
      '#files#': [],
    },
  })

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .filter(key => !['#context#', '#files#'].includes(key))
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    const newVars = {
      ...newPayload,
      '#context#': runInputData['#context#'],
      '#files#': runInputData['#files#'],
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

  const visionFiles = runInputData['#files#']
  const setVisionFiles = useCallback((newFiles: any[]) => {
    setRunInputData({
      ...runInputData,
      '#files#': newFiles,
    })
  }, [runInputData, setRunInputData])

  const allVarStrArr = (() => {
    const arr = isChatModel ? (inputs.prompt_template as PromptItem[]).filter(item => item.edition_type !== EditionType.jinja2).map(item => item.text) : [(inputs.prompt_template as PromptItem).text]
    if (isChatMode && isChatModel && !!inputs.memory) {
      arr.push('{{#sys.query#}}')
      arr.push(inputs.memory.query_prompt_template)
    }

    return arr
  })()

  const varInputs = (() => {
    const vars = getInputVars(allVarStrArr)
    if (isShowVars)
      return [...vars, ...toVarInputs(inputs.prompt_config?.jinja2_variables || [])]

    return vars
  })()

  return {
    readOnly,
    isChatMode,
    inputs,
    isChatModel,
    isCompletionModel,
    hasSetBlockStatus,
    shouldShowContextTip,
    isVisionModel,
    handleModelChanged,
    handleCompletionParamsChange,
    isShowVars,
    handleVarListChange,
    handleVarNameChange,
    handleAddVariable,
    handleAddEmptyVariable,
    handleContextVarChange,
    filterInputVar,
    filterVar: filterMemoryPromptVar,
    availableVars,
    availableNodesWithParent,
    handlePromptChange,
    handleMemoryChange,
    handleSyeQueryChange,
    handleVisionResolutionEnabledChange,
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
