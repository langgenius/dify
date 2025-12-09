import { useCallback, useEffect, useRef, useState } from 'react'
import { EditionType, PromptRole, VarType } from '../../types'
import { produce } from 'immer'
import type { Memory, PromptItem, ValueSelector, Var, Variable } from '../../types'
import type { ToolValue } from '../../block-selector/types'
import { useStore } from '../../store'
import {
  useIsChatMode,
  useNodesReadOnly,
} from '../../hooks'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useConfigVision from '../../hooks/use-config-vision'
import type { LLMNodeType, StructuredOutput } from './types'
import { useModelList, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  ModelFeatureEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { checkHasContextBlock, checkHasHistoryBlock, checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'
import useInspectVarsCrud from '@/app/components/workflow/hooks/use-inspect-vars-crud'
import { REACT_PROMPT_TEMPLATE } from './constants'
import { AppModeEnum } from '@/types/app'

const useConfig = (id: string, payload: LLMNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)?.[payload.type]
  const [defaultRolePrefix, setDefaultRolePrefix] = useState<{ user: string; assistant: string }>({ user: '', assistant: '' })
  const { inputs, setInputs: doSetInputs } = useNodeCrud<LLMNodeType>(id, payload)
  const inputRef = useRef(inputs)
  useEffect(() => {
    inputRef.current = inputs
  }, [inputs])

  const { deleteNodeInspectorVars } = useInspectVarsCrud()

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
  const isChatModel = modelMode === AppModeEnum.CHAT

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
      const newInputs = produce(inputRef.current, (draft) => {
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
        appendDefaultPromptConfig(draft, defaultConfig, model.mode === AppModeEnum.CHAT)
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
    const newInputs = produce(inputRef.current, (draft) => {
      draft.context.variable_selector = newVar as ValueSelector || []
      draft.context.enabled = !!(newVar && newVar.length > 0)
    })
    setInputs(newInputs)
  }, [setInputs])

  const handlePromptChange = useCallback((newPrompt: PromptItem[] | PromptItem) => {
    const newInputs = produce(inputs, (draft) => {
      draft.prompt_template = newPrompt
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleMemoryChange = useCallback((newMemory?: Memory) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.memory = newMemory
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleSyeQueryChange = useCallback((newQuery: string) => {
    const newInputs = produce(inputRef.current, (draft) => {
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
  }, [setInputs])

  // structure output
  const { data: modelList } = useModelList(ModelTypeEnum.textGeneration)
  const currentModelFeatures = modelList
    ?.find(provideItem => provideItem.provider === model?.provider)
    ?.models.find(modelItem => modelItem.model === model?.name)
    ?.features || []

  const isModelSupportStructuredOutput = currentModelFeatures.includes(ModelFeatureEnum.StructuredOutput)
  const isModelSupportToolCall = currentModelFeatures.includes(ModelFeatureEnum.toolCall) || currentModelFeatures.includes(ModelFeatureEnum.streamToolCall)

  const [structuredOutputCollapsed, setStructuredOutputCollapsed] = useState(true)
  const handleStructureOutputEnableChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.structured_output_enabled = enabled
    })
    setInputs(newInputs)
    if (enabled)
      setStructuredOutputCollapsed(false)
    deleteNodeInspectorVars(id)
  }, [setInputs, deleteNodeInspectorVars, id])

  const handleStructureOutputChange = useCallback((newOutput: StructuredOutput) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.structured_output = newOutput
    })
    setInputs(newInputs)
    deleteNodeInspectorVars(id)
  }, [setInputs, deleteNodeInspectorVars, id])

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.number, VarType.string, VarType.secret, VarType.arrayString, VarType.arrayNumber, VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const filterJinja2InputVar = useCallback((varPayload: Var) => {
    return [VarType.number, VarType.string, VarType.secret, VarType.arrayString, VarType.arrayNumber, VarType.arrayBoolean, VarType.arrayObject, VarType.object, VarType.array, VarType.boolean].includes(varPayload.type)
  }, [])

  const filterMemoryPromptVar = useCallback((varPayload: Var) => {
    return [VarType.arrayObject, VarType.array, VarType.number, VarType.string, VarType.secret, VarType.arrayString, VarType.arrayNumber, VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  // reasoning format
  const handleReasoningFormatChange = useCallback((reasoningFormat: 'tagged' | 'separated') => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.reasoning_format = reasoningFormat
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleToolsChange = useCallback((tools: ToolValue[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.tools = tools
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // Auto-manage ReAct prompt based on model support and tool selection
  useEffect(() => {
    if (!isChatModel) return

    // Add a small delay to ensure all state updates have settled
    const timeoutId = setTimeout(() => {
      const promptTemplate = inputs.prompt_template as PromptItem[]
      const systemPromptIndex = promptTemplate.findIndex(item => item.role === 'system')

      const shouldHaveReactPrompt = inputs.tools && inputs.tools.length > 0 && !isModelSupportToolCall

      if (shouldHaveReactPrompt) {
        // Should have ReAct prompt
        let needsAdd = false
        if (systemPromptIndex >= 0) {
          const currentSystemPrompt = promptTemplate[systemPromptIndex].text
          // Check if ReAct prompt is already present by looking for key phrases
          needsAdd = !currentSystemPrompt.includes('{{tools}}') && !currentSystemPrompt.includes('{{tool_names}}')
        }
        else {
          needsAdd = true
        }

        if (needsAdd) {
          const newInputs = produce(inputs, (draft) => {
            const draftPromptTemplate = draft.prompt_template as PromptItem[]
            const sysPromptIdx = draftPromptTemplate.findIndex(item => item.role === 'system')

            if (sysPromptIdx >= 0) {
              // Append ReAct prompt to existing system prompt
              draftPromptTemplate[sysPromptIdx].text
                = `${draftPromptTemplate[sysPromptIdx].text}\n\n${REACT_PROMPT_TEMPLATE}`
            }
            else {
              // Create new system prompt with ReAct template
              draftPromptTemplate.unshift({
                role: PromptRole.system,
                text: REACT_PROMPT_TEMPLATE,
              })
            }
          })
          setInputs(newInputs)
        }
      }
      else {
        // Should NOT have ReAct prompt - remove it if present
        if (systemPromptIndex >= 0) {
          const currentSystemPrompt = promptTemplate[systemPromptIndex].text
          const hasReactPrompt = currentSystemPrompt.includes('{{tools}}') || currentSystemPrompt.includes('{{tool_names}}')

          if (hasReactPrompt) {
            const newInputs = produce(inputs, (draft) => {
              const draftPromptTemplate = draft.prompt_template as PromptItem[]
              const sysPromptIdx = draftPromptTemplate.findIndex(item => item.role === 'system')

              if (sysPromptIdx >= 0) {
                // Remove ReAct prompt from system prompt
                let cleanedText = draftPromptTemplate[sysPromptIdx].text
                // Remove the ReAct template
                cleanedText = cleanedText.replace(`\n\n${REACT_PROMPT_TEMPLATE}`, '')
                cleanedText = cleanedText.replace(REACT_PROMPT_TEMPLATE, '')

                // If system prompt is now empty, remove it entirely
                if (cleanedText.trim() === '')
                  draftPromptTemplate.splice(sysPromptIdx, 1)
                else
                  draftPromptTemplate[sysPromptIdx].text = cleanedText.trim()
              }
            })
            setInputs(newInputs)
          }
        }
      }
    }, 100) // Small delay to let other state updates settle

    return () => clearTimeout(timeoutId)
  }, [inputs.tools?.length, isModelSupportToolCall, isChatModel, setInputs])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterMemoryPromptVar,
  })

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
    isModelSupportStructuredOutput,
    isModelSupportToolCall,
    handleStructureOutputChange,
    structuredOutputCollapsed,
    setStructuredOutputCollapsed,
    handleStructureOutputEnableChange,
    filterJinja2InputVar,
    handleReasoningFormatChange,
    handleToolsChange,
  }
}

export default useConfig
