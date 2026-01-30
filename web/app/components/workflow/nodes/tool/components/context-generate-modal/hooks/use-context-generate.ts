import type { VersionOption } from '../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolParameter } from '@/app/components/tools/types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import type {
  ContextGenerateAvailableVar,
  ContextGenerateCodeContext,
  ContextGenerateMessage,
  ContextGenerateParameterInfo,
  ContextGenerateResponse,
} from '@/service/debug'
import type { CompletionParams, Model, ModelModeType } from '@/types/app'
import { useSessionStorageState } from 'ahooks'
import useBoolean from 'ahooks/lib/useBoolean'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { useStore } from '@/app/components/workflow/store'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { useGetLanguage } from '@/context/i18n'
import { languages } from '@/i18n-config/language'
import { fetchContextGenerateSuggestedQuestions, generateContext } from '@/service/debug'
import { AppModeEnum } from '@/types/app'
import { CONTEXT_GEN_STORAGE_SUFFIX, getContextGenStorageKey } from '../utils/storage'
import useContextGenData from './use-context-gen-data'

export type ContextGenerateChatMessage = ContextGenerateMessage & {
  id?: string
  durationMs?: number
}

export const normalizeCodeLanguage = (value?: string) => {
  if (value === CodeLanguage.javascript)
    return CodeLanguage.javascript
  if (value === CodeLanguage.python3)
    return CodeLanguage.python3
  return CodeLanguage.python3
}

const createChatMessageId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const buildValueSelector = (nodeId: string, variable: Var): ValueSelector => {
  if (!nodeId)
    return variable.variable.split('.')
  const isSys = variable.variable.startsWith('sys.')
  const isEnv = variable.variable.startsWith('env.')
  const isChatVar = variable.variable.startsWith('conversation.')
  const isRagVariable = variable.isRagVariable
  if (isSys || isEnv || isChatVar || isRagVariable)
    return variable.variable.split('.')
  return [nodeId, ...variable.variable.split('.')]
}

const resolveVarSchema = (variable: Var): Record<string, unknown> | undefined => {
  const children = variable.children
  if (!children || Array.isArray(children))
    return undefined
  if (!('schema' in children))
    return undefined
  const schema = children.schema
  if (!schema)
    return undefined
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema) as Record<string, unknown>
    }
    catch {
      return undefined
    }
  }
  return schema as Record<string, unknown>
}

const toAvailableVarsPayload = (
  availableVars: NodeOutPutVar[],
  nodeMap: Map<string, Node>,
): ContextGenerateAvailableVar[] => {
  const results: ContextGenerateAvailableVar[] = []
  availableVars.forEach((nodeVar) => {
    nodeVar.vars.forEach((variable) => {
      const valueSelector = buildValueSelector(nodeVar.nodeId, variable)
      if (!valueSelector.length)
        return
      const schema = resolveVarSchema(variable)
      const description = (variable as { description?: string }).description || variable.des
      const nodeInfo = nodeMap.get(nodeVar.nodeId)
      results.push({
        value_selector: valueSelector,
        type: variable.type,
        description,
        node_id: nodeVar.nodeId,
        node_title: nodeVar.title,
        node_type: nodeInfo?.data?.type,
        schema: schema ?? undefined,
      })
    })
  })
  return results
}

const mapCodeNodeOutputs = (outputs?: Record<string, { type: string } | { type: string, children?: null }>) => {
  if (!outputs)
    return undefined
  const next: Record<string, { type: string }> = {}
  Object.entries(outputs).forEach(([key, value]) => {
    if (!value)
      return
    next[key] = { type: value.type }
  })
  return Object.keys(next).length ? next : undefined
}

const mapCodeNodeVariables = (variables?: Array<{ variable: string, value_selector?: string[] | null }>) => {
  if (!variables)
    return undefined
  return variables.map(variable => ({
    variable: variable.variable,
    value_selector: Array.isArray(variable.value_selector) ? variable.value_selector : [],
  }))
}

type UseContextGenerateOptions = {
  storageKey: string
  toolNodeId: string
  paramKey: string
  codeNodeData?: CodeNodeType
  availableVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

type UseContextGenerateResult = {
  versions: ContextGenerateResponse[]
  current: ContextGenerateResponse | undefined
  currentVersionIndex: number
  setCurrentVersionIndex: (index: number) => void
  promptMessages: ContextGenerateChatMessage[]
  inputValue: string
  setInputValue: (value: string) => void
  suggestedQuestions: string[]
  hasFetchedSuggestions: boolean
  isGenerating: boolean
  model: Model
  handleModelChange: (newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => void
  handleCompletionParamsChange: (newParams: FormValue) => void
  handleGenerate: () => Promise<void>
  handleReset: () => void
  handleFetchSuggestedQuestions: (options?: { force?: boolean }) => Promise<void>
  abortSuggestedQuestions: () => void
  resetSuggestions: () => void
  defaultAssistantMessage: string
  versionOptions: VersionOption[]
  currentVersionLabel: string
  isInitView: boolean
}

const useContextGenerate = ({
  storageKey,
  toolNodeId,
  paramKey,
  codeNodeData,
  availableVars,
  availableNodes,
}: UseContextGenerateOptions): UseContextGenerateResult => {
  const { t, i18n } = useTranslation()
  const locale = useGetLanguage()
  const {
    versions,
    addVersion,
    current,
    currentVersionIndex,
    setCurrentVersionIndex,
    clearVersions,
  } = useContextGenData({
    storageKey,
  })

  const [promptMessages, setPromptMessages] = useSessionStorageState<ContextGenerateChatMessage[]>(
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.messages),
    { defaultValue: [] },
  )

  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [hasFetchedSuggestions, setHasFetchedSuggestions] = useState<boolean>(false)

  const nodes = useStore(s => s.nodes)
  const toolNodeData = useMemo(() => {
    if (!toolNodeId)
      return undefined
    return nodes.find(node => node.id === toolNodeId)?.data as ToolNodeType | undefined
  }, [nodes, toolNodeId])

  const { availableVars: derivedAvailableVars, availableNodesWithParent } = useAvailableVarList(toolNodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
    passedInAvailableNodes: availableNodes,
  })
  const resolvedAvailableVars = useMemo(() => {
    if (availableVars && availableVars.length)
      return availableVars
    return derivedAvailableVars
  }, [availableVars, derivedAvailableVars])
  const resolvedAvailableNodes = useMemo(() => {
    if (availableNodes && availableNodes.length)
      return availableNodes
    return availableNodesWithParent
  }, [availableNodes, availableNodesWithParent])
  const availableNodesMap = useMemo(() => {
    return new Map(resolvedAvailableNodes.map(node => [node.id, node]))
  }, [resolvedAvailableNodes])
  const availableVarsPayload = useMemo(() => {
    return toAvailableVarsPayload(resolvedAvailableVars, availableNodesMap)
  }, [availableNodesMap, resolvedAvailableVars])

  const parameterInfo = useMemo<ContextGenerateParameterInfo>(() => {
    const defaultInfo: ContextGenerateParameterInfo = {
      name: paramKey,
      type: 'string',
      description: '',
    }
    if (!Array.isArray(toolNodeData?.paramSchemas) || !toolNodeData.paramSchemas.length)
      return defaultInfo
    const paramSchema = (toolNodeData.paramSchemas as ToolParameter[]).find(param => param.name === paramKey)
    if (!paramSchema)
      return defaultInfo
    const description = paramSchema.llm_description
      || paramSchema.human_description?.[locale]
      || paramSchema.human_description?.en_US
      || ''
    return {
      name: paramSchema.name || paramKey,
      type: paramSchema.type || 'string',
      description,
      required: paramSchema.required,
      options: paramSchema.options?.map(option => option.value),
      min: paramSchema.min,
      max: paramSchema.max,
      default: paramSchema.default ?? null,
      multiple: paramSchema.multiple,
      label: paramSchema.label?.[locale] || paramSchema.label?.en_US,
    }
  }, [locale, paramKey, toolNodeData])

  const codeContext = useMemo<ContextGenerateCodeContext | undefined>(() => {
    const code = current?.code || codeNodeData?.code || ''
    const outputs = mapCodeNodeOutputs(current?.outputs || codeNodeData?.outputs)
    const variables = mapCodeNodeVariables(current?.variables || codeNodeData?.variables)
    if (!code && !outputs && !variables)
      return undefined
    return {
      code,
      outputs,
      variables,
    }
  }, [codeNodeData?.code, codeNodeData?.outputs, codeNodeData?.variables, current?.code, current?.outputs, current?.variables])

  const [isFetchingSuggestions, { setTrue: setFetchingSuggestionsTrue, setFalse: setFetchingSuggestionsFalse }] = useBoolean(false)
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)

  const promptLanguage = useMemo(() => {
    const matched = languages.find(item => item.value === i18n.language)
    return matched?.prompt_name || 'English'
  }, [i18n.language])

  const [inputValue, setInputValue] = useState('')
  const [isGenerating, { setTrue: setGeneratingTrue, setFalse: setGeneratingFalse }] = useBoolean(false)
  const [modelOverride, setModelOverride] = useState<Model | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.LOCAL.GENERATOR.AUTO_GEN_MODEL)
    if (!stored)
      return null
    const parsed = JSON.parse(stored) as Model
    return {
      ...parsed,
      completion_params: (parsed.completion_params ?? {}) as CompletionParams,
    }
  })

  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const model = useMemo<Model>(() => {
    if (modelOverride)
      return modelOverride
    if (!defaultModel) {
      return {
        name: '',
        provider: '',
        mode: AppModeEnum.CHAT as unknown as ModelModeType.chat,
        completion_params: {} as CompletionParams,
      }
    }
    return {
      name: defaultModel.model,
      provider: defaultModel.provider.provider,
      mode: AppModeEnum.CHAT as unknown as ModelModeType.chat,
      completion_params: {} as CompletionParams,
    }
  }, [defaultModel, modelOverride])

  const modelConfig = useMemo(() => {
    const completionParams = model.completion_params
    if (Object.keys(completionParams).length === 0) {
      return {
        provider: model.provider,
        name: model.name,
      }
    }
    return {
      provider: model.provider,
      name: model.name,
      completion_params: completionParams,
    }
  }, [model.provider, model.name, model.completion_params])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    const newModel = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModelOverride(newModel)
    localStorage.setItem(STORAGE_KEYS.LOCAL.GENERATOR.AUTO_GEN_MODEL, JSON.stringify(newModel))
  }, [model])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModelOverride(newModel)
    localStorage.setItem(STORAGE_KEYS.LOCAL.GENERATOR.AUTO_GEN_MODEL, JSON.stringify(newModel))
  }, [model])

  const promptMessageCount = promptMessages?.length ?? 0
  const hasHistory = (versions?.length ?? 0) > 0 || promptMessageCount > 0
  const isInitView = !isGenerating && !hasHistory
  const defaultAssistantMessage = t('nodes.tool.contextGenerate.defaultAssistantMessage', { ns: 'workflow' })

  const versionOptions = useMemo<VersionOption[]>(() => {
    const latestSuffix = t('generate.latest', { ns: 'appDebug' })
    const versionPrefix = t('generate.version', { ns: 'appDebug' })
    return versions.map((_, index) => ({
      index,
      label: `${versionPrefix} ${index + 1}${index === versions.length - 1 ? ` · ${latestSuffix}` : ''}`,
    }))
  }, [t, versions])

  const currentVersionIndexSafe = currentVersionIndex ?? 0
  const currentVersionLabel = versionOptions[currentVersionIndexSafe]?.label
    ?? `${t('generate.version', { ns: 'appDebug' })} ${currentVersionIndexSafe + 1}`

  const handleReset = useCallback(() => {
    if (isGenerating)
      return
    setPromptMessages([])
    setInputValue('')
    clearVersions()
  }, [clearVersions, isGenerating, setPromptMessages])

  const handleFetchSuggestedQuestions = useCallback(async (options?: { force?: boolean }) => {
    const forceFetch = options?.force
    if (!toolNodeId || !paramKey)
      return
    if (!modelConfig.name || !modelConfig.provider)
      return
    if (!forceFetch && (hasFetchedSuggestions || isFetchingSuggestions || !isInitView))
      return

    setFetchingSuggestionsTrue()
    let shouldMarkFetched = true
    suggestedQuestionsAbortControllerRef.current?.abort()
    try {
      const response = await fetchContextGenerateSuggestedQuestions({
        language: promptLanguage,
        model_config: {
          ...modelConfig,
        },
        available_vars: availableVarsPayload,
        parameter_info: parameterInfo,
      }, (abortController) => {
        suggestedQuestionsAbortControllerRef.current = abortController
      })

      if (response.error) {
        shouldMarkFetched = false
        Toast.notify({
          type: 'error',
          message: t('modal.errors.networkError', { ns: 'pluginTrigger' }),
        })
        setSuggestedQuestions([])
        return
      }

      const nextQuestions = (response.questions || []).filter(question => question && question.trim())
      setSuggestedQuestions(nextQuestions)
    }
    catch (error) {
      if (String(error).includes('AbortError')) {
        shouldMarkFetched = false
        return
      }
      shouldMarkFetched = false
      Toast.notify({
        type: 'error',
        message: t('modal.errors.networkError', { ns: 'pluginTrigger' }),
      })
      setSuggestedQuestions([])
    }
    finally {
      if (shouldMarkFetched)
        setHasFetchedSuggestions(true)
      setFetchingSuggestionsFalse()
    }
  }, [
    availableVarsPayload,
    hasFetchedSuggestions,
    isFetchingSuggestions,
    isInitView,
    modelConfig,
    paramKey,
    parameterInfo,
    promptLanguage,
    setFetchingSuggestionsFalse,
    setFetchingSuggestionsTrue,
    t,
    toolNodeId,
  ])

  const abortSuggestedQuestions = useCallback(() => {
    suggestedQuestionsAbortControllerRef.current?.abort()
  }, [])

  const resetSuggestions = useCallback(() => {
    setSuggestedQuestions([])
    setHasFetchedSuggestions(false)
  }, [])

  const generateStartRef = useRef<number | null>(null)
  const handleGenerate = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isGenerating)
      return
    if (!toolNodeId || !paramKey)
      return

    const userMessage: ContextGenerateChatMessage = { role: 'user', content: trimmed, id: createChatMessageId() }
    const nextMessages: ContextGenerateChatMessage[] = [...(promptMessages ?? []), userMessage]
    setPromptMessages(nextMessages)
    setInputValue('')
    setGeneratingTrue()
    generateStartRef.current = Date.now()
    try {
      const response = await generateContext({
        language: normalizeCodeLanguage(current?.code_language || codeNodeData?.code_language) as 'python3' | 'javascript',
        prompt_messages: nextMessages.map(({ role, content, tool_call_id }) => ({
          role,
          content,
          tool_call_id,
        })),
        model_config: {
          ...modelConfig,
        },
        available_vars: availableVarsPayload,
        parameter_info: parameterInfo,
        code_context: codeContext,
      })

      if (response.error) {
        Toast.notify({
          type: 'error',
          message: response.error,
        })
        return
      }

      const assistantMessage = response.message || defaultAssistantMessage
      const durationMs = generateStartRef.current ? Date.now() - generateStartRef.current : undefined
      const assistantEntry: ContextGenerateChatMessage = {
        role: 'assistant',
        content: assistantMessage,
        durationMs,
        id: createChatMessageId(),
      }
      setPromptMessages([...nextMessages, assistantEntry])
      addVersion(response)
    }
    finally {
      setGeneratingFalse()
      generateStartRef.current = null
    }
  }, [
    addVersion,
    availableVarsPayload,
    codeContext,
    codeNodeData?.code_language,
    current?.code_language,
    defaultAssistantMessage,
    inputValue,
    isGenerating,
    modelConfig,
    paramKey,
    parameterInfo,
    promptMessages,
    setPromptMessages,
    setGeneratingFalse,
    setGeneratingTrue,
    toolNodeId,
  ])

  return {
    versions,
    current,
    currentVersionIndex: currentVersionIndexSafe,
    setCurrentVersionIndex,
    promptMessages: promptMessages ?? [],
    inputValue,
    setInputValue,
    suggestedQuestions,
    hasFetchedSuggestions,
    isGenerating,
    model,
    handleModelChange,
    handleCompletionParamsChange,
    handleGenerate,
    handleReset,
    handleFetchSuggestedQuestions,
    abortSuggestedQuestions,
    resetSuggestions,
    defaultAssistantMessage,
    versionOptions,
    currentVersionLabel,
    isInitView,
  }
}

export default useContextGenerate
