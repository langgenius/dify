import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { ContextGenerateMessage, ContextGenerateResponse } from '@/service/debug'
import type { CompletionParams, Model, ModelModeType } from '@/types/app'
import { useSessionStorageState } from 'ahooks'
import useBoolean from 'ahooks/lib/useBoolean'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { languages } from '@/i18n-config/language'
import { fetchContextGenerateSuggestedQuestions, generateContext } from '@/service/debug'
import { AppModeEnum } from '@/types/app'
import useContextGenData from '../use-context-gen-data'

export type ContextGenerateChatMessage = ContextGenerateMessage & {
  durationMs?: number
}

const defaultCompletionParams: CompletionParams = {
  temperature: 0.7,
  max_tokens: 4096,
  top_p: 0.1,
  echo: false,
  stop: [],
  presence_penalty: 0,
  frequency_penalty: 0,
}

export const normalizeCodeLanguage = (value?: string) => {
  if (value === CodeLanguage.javascript)
    return CodeLanguage.javascript
  if (value === CodeLanguage.python3)
    return CodeLanguage.python3
  return CodeLanguage.python3
}

type UseContextGenerateOptions = {
  storageKey: string
  flowId: string
  toolNodeId: string
  paramKey: string
  codeNodeData?: CodeNodeType
}

type VersionOption = {
  index: number
  label: string
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
  handleFetchSuggestedQuestions: () => Promise<void>
  abortSuggestedQuestions: () => void
  defaultAssistantMessage: string
  versionOptions: VersionOption[]
  currentVersionLabel: string
  isInitView: boolean
}

const useContextGenerate = ({
  storageKey,
  flowId,
  toolNodeId,
  paramKey,
  codeNodeData,
}: UseContextGenerateOptions): UseContextGenerateResult => {
  const { t, i18n } = useTranslation()
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
    `${storageKey}-messages`,
    { defaultValue: [] },
  )

  const [suggestedQuestions, setSuggestedQuestions] = useSessionStorageState<string[]>(
    `${storageKey}-suggested-questions`,
    { defaultValue: [] },
  )

  const [hasFetchedSuggestions, setHasFetchedSuggestions] = useSessionStorageState<boolean>(
    `${storageKey}-suggested-questions-fetched`,
    { defaultValue: false },
  )

  const [isFetchingSuggestions, { setTrue: setFetchingSuggestionsTrue, setFalse: setFetchingSuggestionsFalse }] = useBoolean(false)
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)

  const promptLanguage = useMemo(() => {
    const matched = languages.find(item => item.value === i18n.language)
    return matched?.prompt_name || 'English'
  }, [i18n.language])

  const [inputValue, setInputValue] = useState('')
  const [isGenerating, { setTrue: setGeneratingTrue, setFalse: setGeneratingFalse }] = useBoolean(false)
  const [modelOverride, setModelOverride] = useState<Model | null>(() => {
    const stored = localStorage.getItem('auto-gen-model')
    if (!stored)
      return null
    const parsed = JSON.parse(stored) as Model
    return {
      ...parsed,
      completion_params: {
        ...defaultCompletionParams,
        ...parsed.completion_params,
      },
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
        completion_params: defaultCompletionParams,
      }
    }
    return {
      name: defaultModel.model,
      provider: defaultModel.provider.provider,
      mode: AppModeEnum.CHAT as unknown as ModelModeType.chat,
      completion_params: defaultCompletionParams,
    }
  }, [defaultModel, modelOverride])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    const newModel = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModelOverride(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModelOverride(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
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

  const handleFetchSuggestedQuestions = useCallback(async () => {
    if (!flowId || !toolNodeId || !paramKey)
      return
    if (!model.name || !model.provider)
      return
    if (hasFetchedSuggestions || isFetchingSuggestions || !isInitView)
      return

    setFetchingSuggestionsTrue()
    let shouldMarkFetched = true
    suggestedQuestionsAbortControllerRef.current?.abort()
    try {
      const response = await fetchContextGenerateSuggestedQuestions({
        workflow_id: flowId,
        node_id: toolNodeId,
        parameter_name: paramKey,
        language: promptLanguage,
        model_config: {
          provider: model.provider,
          name: model.name,
          completion_params: model.completion_params,
        },
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
    flowId,
    hasFetchedSuggestions,
    isFetchingSuggestions,
    isInitView,
    model.completion_params,
    model.name,
    model.provider,
    paramKey,
    promptLanguage,
    setFetchingSuggestionsFalse,
    setFetchingSuggestionsTrue,
    setHasFetchedSuggestions,
    setSuggestedQuestions,
    t,
    toolNodeId,
  ])

  const abortSuggestedQuestions = useCallback(() => {
    suggestedQuestionsAbortControllerRef.current?.abort()
  }, [])

  const generateStartRef = useRef<number | null>(null)
  const handleGenerate = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isGenerating)
      return
    if (!flowId || !toolNodeId || !paramKey)
      return

    const userMessage: ContextGenerateChatMessage = { role: 'user', content: trimmed }
    const nextMessages: ContextGenerateChatMessage[] = [...(promptMessages ?? []), userMessage]
    setPromptMessages(nextMessages)
    setInputValue('')
    setGeneratingTrue()
    generateStartRef.current = Date.now()
    try {
      const response = await generateContext({
        workflow_id: flowId,
        node_id: toolNodeId,
        parameter_name: paramKey,
        language: normalizeCodeLanguage(current?.code_language || codeNodeData?.code_language) as 'python3' | 'javascript',
        prompt_messages: nextMessages.map(({ role, content }) => ({ role, content })),
        model_config: {
          provider: model.provider,
          name: model.name,
          completion_params: model.completion_params,
        },
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
    codeNodeData?.code_language,
    current?.code_language,
    defaultAssistantMessage,
    flowId,
    inputValue,
    isGenerating,
    model.completion_params,
    model.name,
    model.provider,
    paramKey,
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
    suggestedQuestions: suggestedQuestions ?? [],
    hasFetchedSuggestions: hasFetchedSuggestions ?? false,
    isGenerating,
    model,
    handleModelChange,
    handleCompletionParamsChange,
    handleGenerate,
    handleReset,
    handleFetchSuggestedQuestions,
    abortSuggestedQuestions,
    defaultAssistantMessage,
    versionOptions,
    currentVersionLabel,
    isInitView,
  }
}

export default useContextGenerate
