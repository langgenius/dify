'use client'
import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { OutputVar } from '@/app/components/workflow/nodes/code/types'
import type { ContextGenerateMessage, ContextGenerateResponse } from '@/service/debug'
import type { AppModeEnum, CompletionParams, Model, ModelModeType } from '@/types/app'
import {
  RiSendPlaneLine,
} from '@remixicon/react'
import { useSessionStorageState } from 'ahooks'
import useBoolean from 'ahooks/lib/useBoolean'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import VersionSelector from '@/app/components/app/configuration/config/automatic/version-selector'
import ResPlaceholder from '@/app/components/app/configuration/config/automatic/res-placeholder'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { NodeRunningStatus, VarType } from '@/app/components/workflow/types'
import { generateContext } from '@/service/debug'
import { cn } from '@/utils/classnames'
import useContextGenData from './use-context-gen-data'

type Props = {
  isShow: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  codeNodeId: string
}

const minCodeHeight = 220
const minOutputHeight = 160
const splitHandleHeight = 6

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

const ContextGenerateModal: FC<Props> = ({
  isShow,
  onClose,
  toolNodeId,
  paramKey,
  codeNodeId,
}) => {
  const { t } = useTranslation()
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
  } = useContextGenData({
    storageKey,
  })

  const [promptMessages, setPromptMessages] = useSessionStorageState<ContextGenerateMessage[]>(
    `${storageKey}-messages`,
    { defaultValue: [] },
  )

  const [inputValue, setInputValue] = useState('')
  const [isGenerating, { setTrue: setGeneratingTrue, setFalse: setGeneratingFalse }] = useBoolean(false)

  const defaultCompletionParams = {
    temperature: 0.7,
    max_tokens: 0,
    top_p: 0,
    echo: false,
    stop: [],
    presence_penalty: 0,
    frequency_penalty: 0,
  }
  const localModel = localStorage.getItem('auto-gen-model')
    ? JSON.parse(localStorage.getItem('auto-gen-model') as string) as Model
    : null
  const [model, setModel] = React.useState<Model>(localModel || {
    name: '',
    provider: '',
    mode: AppModeEnum.CHAT as unknown as ModelModeType.chat,
    completion_params: defaultCompletionParams,
  })

  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  useEffect(() => {
    if (defaultModel) {
      const localModel = localStorage.getItem('auto-gen-model')
        ? JSON.parse(localStorage.getItem('auto-gen-model') || '')
        : null
      if (localModel) {
        setModel({
          ...localModel,
          completion_params: {
            ...defaultCompletionParams,
            ...localModel.completion_params,
          },
        })
      }
      else {
        setModel(prev => ({
          ...prev,
          name: defaultModel.model,
          provider: defaultModel.provider.provider,
        }))
      }
    }
  }, [defaultModel])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    const newModel = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model])

  const chatListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chatListRef.current)
      return
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight
  }, [promptMessages, isGenerating])

  const handleGenerate = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isGenerating)
      return
    if (!flowId || !toolNodeId || !paramKey)
      return

    const nextMessages = [...(promptMessages || []), { role: 'user', content: trimmed }]
    setPromptMessages(nextMessages)
    setInputValue('')
    setGeneratingTrue()
    try {
      const response = await generateContext({
        workflow_id: flowId,
        node_id: toolNodeId,
        parameter_name: paramKey,
        language: normalizeCodeLanguage(current?.code_language || codeNodeData?.code_language) as 'python3' | 'javascript',
        prompt_messages: nextMessages,
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

      const assistantMessage = response.message || t('nodes.tool.contextGenerate.defaultAssistantMessage', { ns: 'workflow' })
      setPromptMessages([...nextMessages, { role: 'assistant', content: assistantMessage }])
      addVersion(response)
    }
    finally {
      setGeneratingFalse()
    }
  }, [
    addVersion,
    codeNodeData?.code_language,
    current?.code_language,
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
    t,
    toolNodeId,
  ])

  const displayVersion = current || fallbackVersion
  const displayCodeLanguage = normalizeCodeLanguage(displayVersion?.code_language)
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
      onClose()
  }, [codeNodeData, codeNodeId, current, handleNodeDataUpdateWithSyncDraft, onClose])

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
  const [codePanelHeight, setCodePanelHeight] = useState(360)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ startY: 0, startHeight: 0 })

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    draggingRef.current = true
    dragStartRef.current = {
      startY: event.clientY,
      startHeight: codePanelHeight,
    }
    document.body.style.userSelect = 'none'
  }, [codePanelHeight])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current)
        return

      const containerHeight = rightContainerRef.current?.offsetHeight || 0
      const maxHeight = Math.max(minCodeHeight, containerHeight - minOutputHeight - splitHandleHeight)
      const delta = event.clientY - dragStartRef.current.startY
      const nextHeight = Math.min(Math.max(dragStartRef.current.startHeight + delta, minCodeHeight), maxHeight)
      setCodePanelHeight(nextHeight)
    }

    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        document.body.style.userSelect = ''
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const canRun = !!displayVersion?.code || !!codeNodeData?.code

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className="min-w-[1140px] !p-0"
    >
      <div className="relative flex h-[680px] flex-wrap">
        <div className="flex h-full w-[420px] shrink-0 flex-col border-r border-divider-regular p-6">
          <div className="mb-4 text-lg font-bold leading-[28px] text-text-primary">
            {t('nodes.tool.contextGenerate.title', { ns: 'workflow' })}
          </div>
          <div className="mb-4">
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
            />
          </div>
          <div
            ref={chatListRef}
            className="flex-1 space-y-2 overflow-y-auto pr-1"
          >
            {(promptMessages || []).map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <div
                  key={`${message.role}-${index}`}
                  className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[320px] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm',
                      isUser
                        ? 'bg-background-gradient-bg-fill-chat-bubble-bg-3 text-text-primary'
                        : 'bg-chat-bubble-bg text-text-primary',
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              )
            })}
            {isGenerating && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-chat-bubble-bg px-4 py-3 text-sm text-text-primary">
                  <LoadingAnim type="text" />
                  <span>{t('nodes.tool.contextGenerate.generating', { ns: 'workflow' })}</span>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Input
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter')
                  handleGenerate()
              }}
              placeholder={t('nodes.tool.contextGenerate.inputPlaceholder', { ns: 'workflow' }) as string}
              disabled={isGenerating}
            />
            <Button
              variant="primary"
              className="shrink-0 px-3"
              disabled={!inputValue.trim() || isGenerating}
              onClick={handleGenerate}
            >
              <RiSendPlaneLine className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex h-full w-0 grow flex-col bg-background-default-subtle p-6 pb-0">
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <div>
              <div className="text-base font-semibold leading-[160%] text-text-secondary">
                {t('nodes.tool.contextGenerate.codeBlock', { ns: 'workflow' })}
              </div>
              {versions.length > 0 && (
                <VersionSelector
                  versionLen={versions.length}
                  value={currentVersionIndex || 0}
                  onChange={setCurrentVersionIndex}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleRun}
                disabled={!canRun || isGenerating || isRunning}
              >
                {t('nodes.tool.contextGenerate.run', { ns: 'workflow' })}
              </Button>
              <Button
                variant="primary"
                onClick={() => applyToNode(true)}
                disabled={!current || isGenerating}
              >
                {t('nodes.tool.contextGenerate.apply', { ns: 'workflow' })}
              </Button>
            </div>
          </div>
          <div ref={rightContainerRef} className="flex h-full flex-col overflow-hidden">
            {isGenerating && !displayVersion && (
              <div className="flex h-full flex-col items-center justify-center space-y-3">
                <Loading />
                <div className="text-[13px] text-text-tertiary">
                  {t('nodes.tool.contextGenerate.generating', { ns: 'workflow' })}
                </div>
              </div>
            )}
            {!isGenerating && !displayVersion && (
              <ResPlaceholder />
            )}
            {displayVersion && (
              <div className="flex h-full flex-col overflow-hidden">
                <div
                  className="flex min-h-[220px] flex-col overflow-hidden rounded-lg border border-components-panel-border bg-components-panel-bg"
                  style={{ height: codePanelHeight }}
                >
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-text-tertiary">
                    {t('nodes.tool.contextGenerate.code', { ns: 'workflow' })}
                  </div>
                  <div className="flex-1 overflow-hidden px-3 pb-3">
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
                <div
                  className="flex h-[6px] cursor-row-resize items-center justify-center"
                  onMouseDown={handleResizeStart}
                >
                  <div className="h-1 w-8 rounded-full bg-divider-subtle" />
                </div>
                <div className="flex min-h-[160px] flex-1 flex-col overflow-hidden rounded-lg border border-components-panel-border bg-components-panel-bg">
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-text-tertiary">
                    {t('nodes.tool.contextGenerate.output', { ns: 'workflow' })}
                  </div>
                  <div className="flex-1 overflow-hidden px-3 pb-3">
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
}

export default React.memo(ContextGenerateModal)
