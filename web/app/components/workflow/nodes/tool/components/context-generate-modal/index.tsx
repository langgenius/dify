'use client'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { TriggerProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import type { CodeNodeType, OutputVar } from '@/app/components/workflow/nodes/code/types'
import type { ContextGenerateMessage, ContextGenerateResponse } from '@/service/debug'
import type { CompletionParams, Model, ModelModeType } from '@/types/app'
import { RiArrowDownSLine, RiArrowRightLine, RiCheckLine, RiCloseLine, RiRefreshLine, RiSendPlaneLine, RiSparklingLine } from '@remixicon/react'
import { useEventListener, useSessionStorageState, useSize } from 'ahooks'
import useBoolean from 'ahooks/lib/useBoolean'
import * as React from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import { CodeAssistant } from '@/app/components/base/icons/src/vender/line/general'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import { renderI18nObject } from '@/i18n-config'
import { languages } from '@/i18n-config/language'
import { fetchContextGenerateSuggestedQuestions, generateContext } from '@/service/debug'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import useContextGenData from './use-context-gen-data'

type Props = {
  isShow: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  codeNodeId: string
}

type ContextGenerateChatMessage = ContextGenerateMessage & {
  durationMs?: number
}

export type ContextGenerateModalHandle = {
  onOpen: () => void
}

const minCodeHeight = 80
const minOutputHeight = 80
const splitHandleHeight = 4
const defaultCodePanelHeight = 556
const defaultCompletionParams: CompletionParams = {
  temperature: 0.7,
  max_tokens: 0,
  top_p: 0,
  echo: false,
  stop: [],
  presence_penalty: 0,
  frequency_penalty: 0,
}

const normalizeCodeLanguage = (value?: string) => {
  if (value === CodeLanguage.javascript)
    return CodeLanguage.javascript
  if (value === CodeLanguage.python3)
    return CodeLanguage.python3
  return CodeLanguage.python3
}

const normalizeOutputs = (outputs?: Record<string, { type: string }>) => {
  const next: OutputVar = {}
  Object.entries(outputs || {}).forEach(([key, value]) => {
    const type = Object.values(VarType).includes(value?.type as VarType)
      ? value.type as VarType
      : VarType.string
    next[key] = {
      type,
      children: null,
    }
  })
  return next
}

const mapOutputsToResponse = (outputs?: OutputVar) => {
  const next: Record<string, { type: string }> = {}
  Object.entries(outputs || {}).forEach(([key, value]) => {
    next[key] = { type: value.type }
  })
  return next
}

const ContextGenerateModal = forwardRef<ContextGenerateModalHandle, Props>(({
  isShow,
  onClose,
  toolNodeId,
  paramKey,
  codeNodeId,
}, ref) => {
  const { t, i18n } = useTranslation()
  const configsMap = useHooksStore(s => s.configsMap)
  const nodes = useStore(s => s.nodes)
  const workflowStore = useWorkflowStore()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const flowId = configsMap?.flowId || ''
  const storageKey = useMemo(() => {
    const segments = [flowId || 'unknown', toolNodeId, paramKey].filter(Boolean)
    return segments.join('-')
  }, [flowId, paramKey, toolNodeId])

  const codeNode = useMemo(() => {
    return nodes.find(node => node.id === codeNodeId)
  }, [codeNodeId, nodes])
  const codeNodeData = codeNode?.data as CodeNodeType | undefined

  const fallbackVersion = useMemo<ContextGenerateResponse | null>(() => {
    if (!codeNodeData)
      return null
    return {
      variables: (codeNodeData.variables || []).map(variable => ({
        variable: variable.variable,
        value_selector: Array.isArray(variable.value_selector) ? variable.value_selector : [],
      })),
      code_language: codeNodeData.code_language,
      code: codeNodeData.code || '',
      outputs: mapOutputsToResponse(codeNodeData.outputs),
      message: '',
      error: '',
    }
  }, [codeNodeData])

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

  const language = useMemo(() => (i18n.language || 'en-US').replace('-', '_'), [i18n.language])
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
  const shouldShowSuggestedSkeleton = isInitView && !hasFetchedSuggestions
  const suggestedQuestionsSafe = suggestedQuestions ?? []
  const suggestedSkeletonItems = useMemo(() => ([
    0,
    1,
    2,
  ]), [])
  const versionOptions = useMemo(() => {
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

  const rightPlaceholderLines = useMemo(() => {
    const placeholder = t('nodes.tool.contextGenerate.rightSidePlaceholder', { ns: 'workflow' })
    return String(placeholder).split('\n').filter(Boolean)
  }, [t])

  const [isVersionMenuOpen, setVersionMenuOpen] = useState(false)
  const handleVersionMenuOpen = useCallback((open: boolean) => {
    if (versions.length > 1)
      setVersionMenuOpen(open)
    else
      setVersionMenuOpen(false)
  }, [versions.length])
  const handleVersionMenuToggle = useCallback(() => {
    if (versions.length > 1)
      setVersionMenuOpen(value => !value)
  }, [versions.length])

  const handleReset = useCallback(() => {
    if (isGenerating)
      return
    setPromptMessages([])
    setInputValue('')
    clearVersions()
  }, [clearVersions, isGenerating, setPromptMessages])

  const handleSuggestedQuestionClick = useCallback((question: string) => {
    setInputValue(question)
  }, [])

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

  const handleCloseModal = useCallback(() => {
    suggestedQuestionsAbortControllerRef.current?.abort()
    onClose()
  }, [onClose])

  useImperativeHandle(ref, () => ({
    onOpen: () => {
      void handleFetchSuggestedQuestions()
    },
  }), [handleFetchSuggestedQuestions])

  const renderModelTrigger = useCallback((params: TriggerProps) => {
    const label = params.currentModel?.label
      ? renderI18nObject(params.currentModel.label, language)
      : (params.currentModel?.model || params.modelId || model.name)
    const modelName = params.currentModel?.model || params.modelId || model.name
    return (
      <div
        className={cn(
          'flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-text-tertiary',
          params.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-state-base-hover',
        )}
      >
        <ModelIcon
          provider={params.currentProvider}
          modelName={modelName}
          className="!h-4 !w-4"
          iconClassName="!h-4 !w-4"
        />
        <span className="max-w-[200px] truncate font-medium text-text-tertiary">
          {label}
        </span>
        <RiArrowDownSLine className="h-3.5 w-3.5 text-text-tertiary" />
      </div>
    )
  }, [language, model])

  const chatListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chatListRef.current)
      return
    if (promptMessageCount === 0 && !isGenerating)
      return
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight
  }, [promptMessageCount, isGenerating])

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

  const displayVersion = isInitView ? null : (current || fallbackVersion)
  const displayCodeLanguage = normalizeCodeLanguage(displayVersion?.code_language)
  const codeLanguageLabel = displayCodeLanguage === CodeLanguage.javascript
    // fixme: do not use i18n to display
    ? t('nodes.tool.contextGenerate.codeLanguage.javascript', { ns: 'workflow' })
    : t('nodes.tool.contextGenerate.codeLanguage.python3', { ns: 'workflow' })
  const displayOutputData = useMemo(() => {
    if (!displayVersion)
      return {}
    return {
      variables: displayVersion.variables,
      outputs: displayVersion.outputs,
    }
  }, [displayVersion])

  const applyToNode = useCallback((closeOnApply: boolean) => {
    if (!current || !codeNodeData)
      return

    const nextOutputs = normalizeOutputs(current.outputs)
    const nextVariables = current.variables.map(item => ({
      variable: item.variable,
      value_selector: Array.isArray(item.value_selector) ? item.value_selector : [],
    }))

    handleNodeDataUpdateWithSyncDraft({
      id: codeNodeId,
      data: {
        ...codeNodeData,
        code_language: normalizeCodeLanguage(current.code_language),
        code: current.code,
        outputs: nextOutputs,
        variables: nextVariables,
      },
    })

    if (closeOnApply)
      handleCloseModal()
  }, [codeNodeData, codeNodeId, current, handleCloseModal, handleNodeDataUpdateWithSyncDraft])

  const handleRun = useCallback(() => {
    if (!codeNodeId)
      return
    if (current)
      applyToNode(false)
    const store = workflowStore.getState()
    store.setInitShowLastRunTab(true)
    store.setPendingSingleRun({
      nodeId: codeNodeId,
      action: 'run',
    })
  }, [applyToNode, codeNodeId, current, workflowStore])

  const isRunning = useMemo(() => {
    const target = nodes.find(node => node.id === codeNodeId)
    return target?.data?._singleRunningStatus === NodeRunningStatus.Running
  }, [codeNodeId, nodes])

  const rightContainerRef = useRef<HTMLDivElement>(null)
  const rightContainerSize = useSize(rightContainerRef)
  const [codePanelHeight, setCodePanelHeight] = useState(defaultCodePanelHeight)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ startY: 0, startHeight: 0 })
  const maxCodePanelHeight = useMemo(() => {
    const containerHeight = rightContainerSize?.height ?? 0
    if (!containerHeight)
      return null
    return Math.max(minCodeHeight, containerHeight - minOutputHeight - splitHandleHeight)
  }, [rightContainerSize?.height])
  const resolvedCodePanelHeight = useMemo(() => {
    if (!maxCodePanelHeight)
      return codePanelHeight
    // Reason: Clamp the panel height so the output area always has space.
    return Math.min(codePanelHeight, maxCodePanelHeight)
  }, [codePanelHeight, maxCodePanelHeight])

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    draggingRef.current = true
    dragStartRef.current = {
      startY: event.clientY,
      startHeight: resolvedCodePanelHeight,
    }
    document.body.style.userSelect = 'none'
  }, [resolvedCodePanelHeight])

  useEventListener('mousemove', (event) => {
    if (!draggingRef.current)
      return

    const containerHeight = rightContainerRef.current?.offsetHeight || 0
    if (!containerHeight)
      return
    const maxHeight = Math.max(minCodeHeight, containerHeight - minOutputHeight - splitHandleHeight)
    const delta = event.clientY - dragStartRef.current.startY
    const nextHeight = Math.min(Math.max(dragStartRef.current.startHeight + delta, minCodeHeight), maxHeight)
    setCodePanelHeight(nextHeight)
  })

  useEventListener('mouseup', () => {
    if (!draggingRef.current)
      return
    draggingRef.current = false
    document.body.style.userSelect = ''
  })

  const canRun = !!displayVersion?.code || !!codeNodeData?.code
  const emptyPanelClassName = cn(
    'flex h-full flex-col',
    isInitView
      ? 'rounded-l-xl bg-components-panel-bg pb-1 pl-1'
      : 'rounded-[10px] bg-components-panel-bg',
  )

  return (
    <Modal
      isShow={isShow}
      onClose={handleCloseModal}
      className={cn(
        'max-w-[calc(100vw-32px)] border-[0.5px] border-components-panel-border bg-background-body !p-0 shadow-xl shadow-shadow-shadow-5',
        isInitView ? 'w-[1280px]' : 'w-[1200px]',
      )}
    >
      <div className="relative flex h-[720px] max-h-[calc(100vh-32px)] flex-wrap">
        <div
          className={cn(
            'flex h-full w-[400px] shrink-0 flex-col border-r border-divider-regular bg-background-body',
            isInitView ? 'justify-center pb-20' : 'justify-start',
          )}
        >
          <div
            className={cn(
              'bg-gradient-to-b from-background-body to-transparent backdrop-blur-[4px]',
              isInitView ? 'px-5 py-4' : 'px-4 pb-4 pt-3',
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <div className="title-2xl-semi-bold bg-gradient-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text text-transparent">
                  {t('nodes.tool.contextGenerate.title', { ns: 'workflow' })}
                </div>
                {isInitView && (
                  <div className="mt-1 text-[13px] italic leading-4 text-text-tertiary">
                    {t('nodes.tool.contextGenerate.subtitle', { ns: 'workflow' })}
                  </div>
                )}
              </div>
              {!isInitView && (
                <ActionButton
                  size="m"
                  className={cn('!h-8 !w-8', isGenerating && 'pointer-events-none opacity-50')}
                  onClick={handleReset}
                >
                  <RiRefreshLine className="h-4 w-4 text-text-tertiary" />
                </ActionButton>
              )}
            </div>
          </div>

          {isInitView
            ? (
                <div className="flex w-full flex-col gap-1 px-2">
                  <div className="bg-gradient-to-b from-[rgba(255,255,255,0.01)] to-background-body px-2 pb-2 pt-3">
                    <div className="flex h-[120px] flex-col justify-between overflow-hidden rounded-xl border-[0.5px] border-components-input-border-active bg-components-panel-bg shadow-shadow-shadow-5 backdrop-blur-[5px]">
                      <div className="flex min-h-[64px] px-3 pb-1 pt-2.5">
                        <textarea
                          value={inputValue}
                          onChange={e => setInputValue(e.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              handleGenerate()
                            }
                          }}
                          placeholder={t('nodes.tool.contextGenerate.initPlaceholder', { ns: 'workflow' }) as string}
                          className="w-full resize-none bg-transparent text-sm leading-5 text-text-primary placeholder:text-text-quaternary focus:outline-none"
                          disabled={isGenerating}
                          rows={2}
                        />
                      </div>
                      <div className="flex items-end gap-2 p-2">
                        <ModelParameterModal
                          popupClassName="!w-[520px]"
                          portalToFollowElemContentClassName="z-[1000]"
                          isAdvancedMode={true}
                          provider={model.provider}
                          completionParams={model.completion_params}
                          modelId={model.name}
                          setModel={handleModelChange}
                          onCompletionParamsChange={handleCompletionParamsChange}
                          hideDebugWithMultipleModel
                          renderTrigger={renderModelTrigger}
                        />
                        <Button
                          variant="primary"
                          size="small"
                          className="!h-8 !w-8 shrink-0 !rounded-lg !px-0"
                          disabled={!inputValue.trim() || isGenerating}
                          onClick={handleGenerate}
                        >
                          <RiSendPlaneLine className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-px px-2">
                    <div className="flex items-center px-3 pb-2 pt-4">
                      <span className="text-xs font-semibold uppercase text-text-tertiary">
                        {t('nodes.tool.contextGenerate.suggestedQuestionsTitle', { ns: 'workflow' })}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 px-3">
                      {shouldShowSuggestedSkeleton && suggestedSkeletonItems.map(item => (
                        <SkeletonRow key={item} className="py-1">
                          <div className="h-4 w-4 rounded-sm bg-divider-subtle opacity-60" />
                          <SkeletonRectangle className="h-3 w-[260px]" />
                        </SkeletonRow>
                      ))}
                      {!shouldShowSuggestedSkeleton && suggestedQuestionsSafe.map((question, index) => (
                        <button
                          key={`${question}-${index}`}
                          type="button"
                          className="flex items-start gap-2 rounded-lg px-2 py-1 text-left text-sm text-text-secondary transition hover:bg-state-base-hover"
                          onClick={() => handleSuggestedQuestionClick(question)}
                        >
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-divider-regular" />
                          <span className="flex-1 whitespace-pre-wrap">{question}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            : (
                <>
                  <div
                    ref={chatListRef}
                    className="flex-1 overflow-y-auto px-4 py-2"
                  >
                    <div className="flex w-full flex-col items-end gap-4 pt-3">
                      {(() => {
                        let assistantIndex = -1
                        return (promptMessages || []).map((message, index) => {
                          if (message.role === 'assistant')
                            assistantIndex += 1
                          const versionMeta = message.role === 'assistant' ? versionOptions[assistantIndex] : null
                          const isSelected = versionMeta?.index === currentVersionIndexSafe
                          const showThoughtProcess = message.role === 'assistant' && message.content !== defaultAssistantMessage
                          const durationLabel = message.role === 'assistant' && message.durationMs
                            ? `${(message.durationMs / 1000).toFixed(1)}s`
                            : null
                          return (
                            <div
                              key={`${message.role}-${index}`}
                              className={cn('flex w-full', message.role === 'user' ? 'justify-end' : 'justify-start')}
                            >
                              {message.role === 'user'
                                ? (
                                    <div className="max-w-[320px] whitespace-pre-wrap rounded-xl bg-util-colors-blue-brand-blue-brand-500 px-3 py-2 text-sm leading-5 text-text-primary-on-surface">
                                      {message.content}
                                    </div>
                                  )
                                : (
                                    <div className="flex w-full flex-col items-start gap-2">
                                      {showThoughtProcess && (
                                        <div className="flex w-full items-center gap-1 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-2 px-2 py-2 text-[13px] text-text-secondary">
                                          <div className="flex h-5 w-5 items-center justify-center">
                                            <RiSparklingLine className="h-4 w-4 text-text-secondary" />
                                          </div>
                                          <span className="flex-1 truncate">
                                            {message.content}
                                          </span>
                                          {durationLabel && (
                                            <span className="text-xs text-text-tertiary">
                                              {durationLabel}
                                            </span>
                                          )}
                                          <RiArrowDownSLine className="h-4 w-4 -rotate-90 text-text-secondary" />
                                        </div>
                                      )}
                                      <div className="whitespace-pre-wrap px-2 text-sm leading-5 text-text-primary">
                                        {showThoughtProcess ? defaultAssistantMessage : message.content}
                                      </div>
                                      {versionMeta && (
                                        <button
                                          type="button"
                                          className={cn(
                                            'flex min-h-[40px] w-full items-center gap-2 rounded-[12px] border-[0.5px] bg-components-card-bg px-3 py-2 text-left',
                                            isSelected
                                              ? 'border-[1.5px] border-components-option-card-option-selected-border'
                                              : 'border-components-panel-border-subtle',
                                          )}
                                          onClick={() => setCurrentVersionIndex(versionMeta.index)}
                                        >
                                          <div className="flex h-4 w-4 items-center justify-center rounded-[5px] border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 p-[2px] shadow-xs">
                                            <CodeAssistant className="h-3 w-3 text-text-primary-on-surface" />
                                          </div>
                                          <span className="flex-1 text-[13px] font-medium text-text-primary">
                                            {versionMeta.label}
                                          </span>
                                          <RiArrowRightLine className="h-4 w-4 text-text-tertiary" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                            </div>
                          )
                        })
                      })()}
                      {isGenerating && (
                        <div className="flex w-full items-center gap-2 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-2 px-2 py-2 text-xs text-text-secondary">
                          <LoadingAnim type="text" />
                          <span>{t('nodes.tool.contextGenerate.generating', { ns: 'workflow' })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="bg-gradient-to-b from-[rgba(255,255,255,0.01)] to-background-body px-1 pb-1 pt-3">
                    <div className="flex min-h-[112px] flex-col justify-between overflow-hidden rounded-xl border-[0.5px] border-components-input-border-active bg-components-panel-bg shadow-shadow-shadow-5 backdrop-blur-[5px]">
                      <div className="flex min-h-[64px] px-3 pb-1 pt-2.5">
                        <textarea
                          value={inputValue}
                          onChange={e => setInputValue(e.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              handleGenerate()
                            }
                          }}
                          placeholder={t('nodes.tool.contextGenerate.inputPlaceholder', { ns: 'workflow' }) as string}
                          className="w-full resize-none bg-transparent text-sm leading-5 text-text-primary placeholder:text-text-quaternary focus:outline-none"
                          disabled={isGenerating}
                          rows={2}
                        />
                      </div>
                      <div className="flex items-end gap-2 p-2">
                        <ModelParameterModal
                          popupClassName="!w-[520px]"
                          portalToFollowElemContentClassName="z-[1000]"
                          isAdvancedMode={true}
                          provider={model.provider}
                          completionParams={model.completion_params}
                          modelId={model.name}
                          setModel={handleModelChange}
                          onCompletionParamsChange={handleCompletionParamsChange}
                          hideDebugWithMultipleModel
                          renderTrigger={renderModelTrigger}
                        />
                        <Button
                          variant="primary"
                          size="small"
                          className="!h-8 !w-8 shrink-0 !rounded-lg !px-0"
                          disabled={!inputValue.trim() || isGenerating}
                          onClick={handleGenerate}
                        >
                          <RiSendPlaneLine className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
        </div>
        <div
          className={cn(
            'flex h-full w-0 grow flex-col bg-background-body',
            isInitView ? 'py-1' : 'pt-1',
          )}
        >
          {isInitView && (
            <div className="flex h-10 items-center justify-end px-3 py-1">
              <ActionButton size="m" className="!h-8 !w-8" onClick={handleCloseModal}>
                <RiCloseLine className="h-4 w-4 text-text-tertiary" />
              </ActionButton>
            </div>
          )}
          {!isInitView && (
            <div className="flex shrink-0 items-center justify-between px-3 py-2">
              <div className="flex flex-col gap-1">
                <div className="text-[13px] font-semibold uppercase text-text-secondary">
                  {t('nodes.tool.contextGenerate.generatedCode', { ns: 'workflow' })}
                </div>
                <PortalToFollowElem
                  placement="bottom-start"
                  offset={{
                    mainAxis: 6,
                    crossAxis: -4,
                  }}
                  open={isVersionMenuOpen}
                  onOpenChange={handleVersionMenuOpen}
                >
                  <PortalToFollowElemTrigger asChild onClick={handleVersionMenuToggle}>
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-1 text-xs font-medium text-text-tertiary',
                        versions.length > 1 ? 'cursor-pointer' : 'cursor-default',
                      )}
                    >
                      <span>{currentVersionLabel}</span>
                      {versions.length > 1 && <RiArrowDownSLine className="h-3.5 w-3.5" />}
                    </button>
                  </PortalToFollowElemTrigger>
                  <PortalToFollowElemContent className="z-[1010]">
                    <div className="w-[208px] rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
                      <div className="system-xs-medium-uppercase flex h-[22px] items-center px-3 text-text-tertiary">
                        {t('generate.versions', { ns: 'appDebug' })}
                      </div>
                      {versionOptions.map(option => (
                        <button
                          key={option.index}
                          type="button"
                          className={cn(
                            'flex h-7 w-full items-center rounded-lg px-2 text-[13px] text-text-secondary',
                            option.index === currentVersionIndexSafe
                              ? 'bg-state-base-hover'
                              : 'hover:bg-state-base-hover',
                          )}
                          onClick={() => {
                            setCurrentVersionIndex(option.index)
                            setVersionMenuOpen(false)
                          }}
                        >
                          <span className="flex-1 truncate text-left">{option.label}</span>
                          {option.index === currentVersionIndexSafe && (
                            <RiCheckLine className="h-4 w-4 text-text-accent" />
                          )}
                        </button>
                      ))}
                    </div>
                  </PortalToFollowElemContent>
                </PortalToFollowElem>
              </div>
              <div className="flex items-center gap-2">
                {isRunning
                  ? (
                      <div className="flex h-8 items-center gap-2 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-bg px-3 text-xs font-medium text-text-secondary">
                        <span className="h-2 w-2 rounded-full bg-util-colors-blue-blue-500" />
                        {t('nodes.tool.contextGenerate.running', { ns: 'workflow' })}
                      </div>
                    )
                  : (
                      <Button
                        size="small"
                        onClick={handleRun}
                        disabled={!canRun || isGenerating}
                      >
                        {t('nodes.tool.contextGenerate.run', { ns: 'workflow' })}
                      </Button>
                    )}
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => applyToNode(true)}
                  disabled={!current || isGenerating}
                >
                  {t('nodes.tool.contextGenerate.apply', { ns: 'workflow' })}
                </Button>
                <div className="mx-1 h-4 w-px bg-divider-regular" />
                <ActionButton size="m" className="!h-8 !w-8" onClick={handleCloseModal}>
                  <RiCloseLine className="h-4 w-4 text-text-tertiary" />
                </ActionButton>
              </div>
            </div>
          )}
          <div
            ref={rightContainerRef}
            className={cn(
              'flex h-full flex-col overflow-hidden',
              isInitView ? 'px-0 pb-0' : 'px-3 pb-3',
            )}
          >
            {isGenerating && !displayVersion && (
              <div className={cn(emptyPanelClassName, 'items-center justify-center')}>
                <Loading />
                <div className="mt-3 text-[13px] text-text-tertiary">
                  {t('nodes.tool.contextGenerate.generating', { ns: 'workflow' })}
                </div>
              </div>
            )}
            {!isGenerating && !displayVersion && (
              <div className={emptyPanelClassName}>
                <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-20 text-center">
                  <CodeAssistant className="h-8 w-8 text-divider-regular" />
                  <div className="text-xs leading-4 text-text-quaternary">
                    {rightPlaceholderLines.map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {displayVersion && (
              <div className="flex h-full flex-col overflow-hidden">
                <div
                  className="flex min-h-[80px] flex-col overflow-hidden rounded-[10px] bg-components-input-bg-normal"
                  style={{ height: resolvedCodePanelHeight }}
                >
                  <div className="flex items-center border-b border-divider-subtle px-2 py-1">
                    <div className="flex flex-1 items-center px-1 py-0.5">
                      <span className="text-xs font-semibold uppercase text-text-secondary">
                        {codeLanguageLabel}
                      </span>
                    </div>
                    <CopyFeedbackNew content={displayVersion.code || ''} className="!h-6 !w-6" />
                  </div>
                  <div className="flex-1 overflow-hidden px-3 pb-3 pt-2">
                    <CodeEditor
                      noWrapper
                      isExpand
                      readOnly
                      language={displayCodeLanguage}
                      value={displayVersion.code || ''}
                      className="h-full"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-4 w-full cursor-row-resize items-center px-2"
                  aria-label={t('nodes.tool.contextGenerate.resizeHandle', { ns: 'workflow' })}
                  onPointerDown={handleResizeStart}
                >
                  <div className="h-[2px] w-full rounded-full bg-divider-subtle" />
                </button>
                <div className="flex min-h-[80px] flex-1 flex-col overflow-hidden rounded-[10px] bg-components-input-bg-normal">
                  <div className="flex items-center border-b border-divider-subtle px-2 py-1">
                    <div className="flex flex-1 items-center px-1 py-0.5">
                      <span className="text-xs font-semibold uppercase text-text-secondary">
                        {t('nodes.tool.contextGenerate.output', { ns: 'workflow' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden px-3 pb-3 pt-2">
                    <CodeEditor
                      noWrapper
                      isExpand
                      readOnly
                      isJSONStringifyBeauty
                      language={CodeLanguage.json}
                      value={displayOutputData}
                      className="h-full"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
})

ContextGenerateModal.displayName = 'ContextGenerateModal'

export default React.memo(ContextGenerateModal)
