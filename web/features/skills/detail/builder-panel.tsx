'use client'

/* oxlint-disable eslint-react/set-state-in-effect -- The builder resets its local transcript when the authoritative detail snapshot changes. */

import type {
  SkillDetailResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { BuilderChatMessage, SkillBuilderAttachment, SkillBuilderModel } from './shared'
import type {
  FormValue,
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { sendSkillAssistMessage, uploadSkillFile } from '../client'
import {
  findFileByPath,
  isAllowedSkillBuilderAttachment,
  isDefaultSkillBuilderDraft,
  isRecord,
  isTextFile,
  setSkillDetailCache,
  skillBuilderAttachmentAccept,
} from './shared'

function BuilderModelSelector({
  isLoading,
  modelList,
  selectedModel,
  onSelect,
}: {
  isLoading: boolean
  modelList: Model[]
  selectedModel: SkillBuilderModel | undefined
  onSelect: (model: SkillBuilderModel) => void
}) {
  return (
    <div className="max-w-full min-w-0">
      {isLoading ? (
        <div className="h-6 w-20 rounded-md bg-state-base-hover" />
      ) : (
        <ModelParameterModal
          isAdvancedMode
          modelId={selectedModel?.model ?? ''}
          provider={selectedModel?.provider ?? ''}
          completionParams={(selectedModel?.model_settings ?? {}) as FormValue}
          hideDebugWithMultipleModel
          modelList={modelList}
          popupClassName="w-[400px]"
          triggerContainerClassName="max-w-full min-w-0"
          setModel={({ modelId, provider }) => {
            onSelect({
              ...selectedModel,
              provider,
              model: modelId,
            })
          }}
          onCompletionParamsChange={(modelSettings) => {
            if (!selectedModel) return

            onSelect({
              ...selectedModel,
              model_settings: modelSettings,
            })
          }}
        />
      )}
    </div>
  )
}

export function SkillBuilderPanel({
  detail,
  onDraftDetailChange,
  onClose,
  selectedFile,
  skillId,
}: {
  detail: SkillDetailResponse
  onDraftDetailChange: (detail: SkillDetailResponse) => void
  onClose: () => void
  selectedFile: SkillFileResponse | undefined
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const { t: tAgentV2 } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState('')
  const initialBuilderModeRef = useRef({
    isEditMode: !isDefaultSkillBuilderDraft(detail),
    skillId,
  })
  if (initialBuilderModeRef.current.skillId !== skillId) {
    initialBuilderModeRef.current = {
      isEditMode: !isDefaultSkillBuilderDraft(detail),
      skillId,
    }
  }
  const isEditMode = initialBuilderModeRef.current.isEditMode
  const initialMessages = useMemo<BuilderChatMessage[]>(
    () =>
      isEditMode
        ? [
            {
              id: `assistant-${skillId}-intro`,
              role: 'assistant',
              content: t(($) => $['skillManagement.detail.builder.editIntro']),
            },
          ]
        : [],
    [isEditMode, skillId, t],
  )
  const [messages, setMessages] = useState<BuilderChatMessage[]>(initialMessages)
  const messagesRef = useRef<BuilderChatMessage[]>(initialMessages)
  const rawAssistantMessagesRef = useRef(new Map<string, string>())
  const [attachments, setAttachments] = useState<SkillBuilderAttachment[]>([])
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const isComposingRef = useRef(false)
  const detailRef = useRef(detail)
  const selectedFileRef = useRef(selectedFile)
  const assistAbortControllerRef = useRef<AbortController | null>(null)
  const { data: defaultTextGenerationModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: textGenerationModelList, isLoading: isTextGenerationModelListLoading } =
    useModelList(ModelTypeEnum.textGeneration)
  const fallbackModel = useMemo<SkillBuilderModel | undefined>(() => {
    for (const provider of textGenerationModelList) {
      if (provider.status !== ModelStatusEnum.active) continue

      const model = provider.models.find((model) => model.status === ModelStatusEnum.active)
      if (model) {
        return {
          provider: provider.provider,
          model: model.model,
        }
      }
    }

    return undefined
  }, [textGenerationModelList])
  const defaultBuilderModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const [selectedModel, setSelectedModel] = useState<SkillBuilderModel | undefined>()
  const activeSelectedModel = selectedModel ?? defaultBuilderModel ?? fallbackModel
  const canSendBuilderMessage = !!activeSelectedModel?.provider && !!activeSelectedModel?.model
  const suggestions = [
    t(($) => $['skillManagement.detail.builder.exampleIssueTriage']),
    t(($) => $['skillManagement.detail.builder.exampleSalesFollowUp']),
    t(($) => $['skillManagement.detail.builder.exampleOnboarding']),
  ]
  const followUpSuggestions = [
    t(($) => $['skillManagement.detail.builder.followUpNameIcon']),
    t(($) => $['skillManagement.detail.builder.followUpDisplayName']),
    t(($) => $['skillManagement.detail.builder.exampleIssueTriage']),
  ]
  const inputPlaceholder =
    messages.length > 0
      ? t(($) => $['skillManagement.detail.builder.modifyPlaceholder'])
      : t(($) => $['skillManagement.detail.builder.placeholder'])

  const updateMessages = (
    updater: (currentMessages: BuilderChatMessage[]) => BuilderChatMessage[],
  ) => {
    setMessages((currentMessages) => {
      const nextMessages = updater(currentMessages)
      messagesRef.current = nextMessages
      return nextMessages
    })
  }

  useEffect(() => {
    detailRef.current = detail
  }, [detail])

  useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  useEffect(() => {
    messagesRef.current = initialMessages
    rawAssistantMessagesRef.current.clear()
    setMessages(initialMessages)
  }, [initialMessages])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    return () => {
      assistAbortControllerRef.current?.abort()
    }
  }, [])

  const handleRestart = () => {
    assistAbortControllerRef.current?.abort()
    assistAbortControllerRef.current = null
    setPrompt('')
    messagesRef.current = initialMessages
    rawAssistantMessagesRef.current.clear()
    setMessages(initialMessages)
    setAttachments([])
    setIsUploadingAttachment(false)
    setIsSending(false)
    isSendingRef.current = false
  }

  const handleClose = () => {
    assistAbortControllerRef.current?.abort()
    assistAbortControllerRef.current = null
    isSendingRef.current = false
    setIsSending(false)
    onClose()
  }

  const handleCompositionStart = () => {
    isComposingRef.current = true
  }

  const handleCompositionEnd = () => {
    // Safari can fire compositionend before the Enter keydown that confirms the composition.
    window.setTimeout(() => {
      isComposingRef.current = false
    }, 50)
  }

  const handleAttachmentChange = async (file: File | undefined) => {
    if (!file || isUploadingAttachment) return
    if (!isAllowedSkillBuilderAttachment(file)) {
      toast.error(t(($) => $['skillManagement.detail.builder.attachUnsupported']))
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      return
    }

    setIsUploadingAttachment(true)
    try {
      const uploadedFile = await uploadSkillFile(file)

      setAttachments((currentAttachments) => [
        ...currentAttachments,
        {
          id: uploadedFile.id,
          mimeType: uploadedFile.mime_type || file.type || 'application/octet-stream',
          name: uploadedFile.name || file.name,
          size: uploadedFile.size ?? file.size,
          toolFileId: uploadedFile.id,
        },
      ])
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['skillManagement.detail.builder.attachFailed']),
      )
    } finally {
      setIsUploadingAttachment(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  const removeAttachment = (attachmentId: string) => {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    )
  }

  const getBuilderTargetFile = (currentDetail: SkillDetailResponse) => {
    const currentSelectedFile = selectedFileRef.current
    if (currentSelectedFile && isTextFile(currentSelectedFile)) {
      const latestSelectedFile = findFileByPath(currentDetail.files ?? [], currentSelectedFile.path)
      if (latestSelectedFile && isTextFile(latestSelectedFile)) return latestSelectedFile
    }

    const skillMd = findFileByPath(currentDetail.files ?? [], 'SKILL.md')
    return skillMd && isTextFile(skillMd) ? skillMd : undefined
  }

  const handleSend = (messageText = prompt) => {
    const trimmedPrompt = messageText.trim()
    const attachedFiles = attachments
    if (
      !canSendBuilderMessage ||
      (!trimmedPrompt && attachedFiles.length === 0) ||
      isUploadingAttachment ||
      isSendingRef.current
    )
      return
    isSendingRef.current = true
    const requestMessage =
      trimmedPrompt || t(($) => $['skillManagement.detail.builder.attachmentOnlyMessage'])

    const userMessage: BuilderChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: requestMessage,
    }
    const assistantMessageId = `assistant-${Date.now()}`
    const assistantMessage: BuilderChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
    }

    updateMessages((currentMessages) => [...currentMessages, userMessage, assistantMessage])
    setPrompt('')
    setAttachments([])
    setIsSending(true)

    void sendSkillAssistMessage({
      skillId,
      attachments: attachedFiles.map((attachment) => ({
        mime_type: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
        tool_file_id: attachment.toolFileId,
      })),
      message: requestMessage,
      model: activeSelectedModel,
      targetPath: getBuilderTargetFile(detailRef.current)?.path,
      getAbortController: (abortController) => {
        assistAbortControllerRef.current = abortController
      },
      onData: (chunk) => {
        if (!chunk) return

        const rawAssistantContent = `${
          rawAssistantMessagesRef.current.get(assistantMessageId) ?? ''
        }${chunk}`
        rawAssistantMessagesRef.current.set(assistantMessageId, rawAssistantContent)

        updateMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: rawAssistantContent,
                  rawContent: rawAssistantContent,
                }
              : message,
          ),
        )
      },
      onUnhandledEvent: (event) => {
        if (event.event !== 'skill_detail_updated' || !isRecord(event.detail)) return

        const nextDetail = event.detail as SkillDetailResponse
        detailRef.current = nextDetail
        setSkillDetailCache(queryClient, skillId, nextDetail)
        onDraftDetailChange(nextDetail)
      },
      onCompleted: (hasError, errorMessage) => {
        setIsSending(false)
        isSendingRef.current = false
        assistAbortControllerRef.current = null
        if (hasError && errorMessage) toast.error(errorMessage)
      },
      onError: (errorMessage) => {
        setIsSending(false)
        isSendingRef.current = false
        assistAbortControllerRef.current = null
        if (errorMessage) toast.error(errorMessage)
      },
    }).catch((error: unknown) => {
      setIsSending(false)
      isSendingRef.current = false
      assistAbortControllerRef.current = null
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['skillManagement.detail.builder.sendFailed']),
      )
    })
  }

  return (
    <aside className="relative flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-divider-subtle bg-background-section">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.32]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgb(99 102 241 / 0.18) 1px, transparent 0)',
          backgroundSize: '12px 12px',
        }}
      />
      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-2 px-4">
        <h2 className="system-xs-semibold-uppercase text-text-secondary">
          {t(($) => $['skillManagement.detail.builder.title'])}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.builder.restart'])}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={handleRestart}
          >
            <span aria-hidden className="i-ri-restart-line size-4" />
          </button>
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.builder.close'])}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={handleClose}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-5 pb-6">
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {messages.length > 0 ? (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'max-w-[94%] overflow-x-auto rounded-xl px-3 py-2 shadow-xs',
                    message.role === 'user'
                      ? 'ml-auto bg-state-accent-hover text-text-secondary'
                      : 'mr-auto bg-background-default text-text-secondary',
                  )}
                >
                  {message.content ? (
                    <Markdown content={message.content} className="text-[13px]! leading-5!" />
                  ) : (
                    <span className="system-xs-regular text-text-tertiary">
                      {tAgentV2(($) => $['agentDetail.configure.answer.thinking'])}
                    </span>
                  )}
                </div>
              ))}
              {messages.length > initialMessages.length && (
                <div className="flex flex-col items-end gap-2 pt-2">
                  {followUpSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="max-w-full cursor-pointer rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-right system-xs-medium text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSending || isUploadingAttachment || !canSendBuilderMessage}
                      onClick={() => handleSend(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-full flex-col justify-end">
              <div className="mb-5 flex flex-col items-center text-center">
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-state-accent-hover bg-state-accent-hover text-text-accent shadow-xs">
                  <span aria-hidden className="i-ri-box-3-line size-5" />
                </div>
                <h3 className="system-sm-semibold text-text-secondary">
                  {t(($) => $['skillManagement.detail.builder.promptTitle'])}
                </h3>
                <p className="mt-1 max-w-56 system-xs-regular text-text-tertiary">
                  {t(($) => $['skillManagement.detail.builder.promptDescription'])}
                </p>
              </div>
              <div className="mb-4 space-y-2">
                <p className="system-2xs-semibold-uppercase text-text-quaternary">
                  {t(($) => $['skillManagement.detail.builder.tryExample'])}
                </p>
                <div className="flex flex-col items-end gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="max-w-full cursor-pointer rounded-md border border-divider-subtle bg-background-default px-2 py-1 text-right system-xs-medium text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSending || isUploadingAttachment || !canSendBuilderMessage}
                      onClick={() => handleSend(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 rounded-xl border border-divider-subtle bg-background-default px-3 py-2 shadow-lg">
          <input
            ref={attachmentInputRef}
            type="file"
            accept={skillBuilderAttachmentAccept}
            className="hidden"
            onChange={(event) => {
              void handleAttachmentChange(event.currentTarget.files?.[0])
            }}
          />
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex max-w-full min-w-0 items-center gap-1 rounded-md border border-divider-subtle bg-background-section px-2 py-1 system-xs-regular text-text-secondary"
                >
                  <span
                    aria-hidden
                    className="i-ri-attachment-2 size-3.5 shrink-0 text-text-tertiary"
                  />
                  <span className="min-w-0 truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={t(($) => $['skillManagement.detail.builder.removeAttachment'], {
                      name: attachment.name,
                    })}
                    className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-text-quaternary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    disabled={isSending}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <span aria-hidden className="i-ri-close-line size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={prompt}
            rows={2}
            className="h-10 w-full resize-none bg-transparent system-sm-regular text-text-secondary outline-hidden placeholder:text-text-quaternary"
            placeholder={inputPlaceholder}
            disabled={isSending}
            onChange={(event) => setPrompt(event.target.value)}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return
              if (event.nativeEvent.isComposing || isComposingRef.current) return

              event.preventDefault()
              handleSend()
            }}
          />
          <div className="mt-1 flex h-7 min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <BuilderModelSelector
                isLoading={isTextGenerationModelListLoading}
                modelList={textGenerationModelList}
                selectedModel={activeSelectedModel}
                onSelect={setSelectedModel}
              />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-divider-subtle pl-1">
              <button
                type="button"
                aria-label={t(($) => $['skillManagement.detail.builder.attach'])}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSending || isUploadingAttachment}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <span
                  aria-hidden
                  className={cn(
                    isUploadingAttachment ? 'i-ri-loader-4-line animate-spin' : 'i-ri-attachment-2',
                    'size-4',
                  )}
                />
              </button>
              <Tooltip>
                <TooltipTrigger
                  className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  aria-label={t(($) => $['skillManagement.detail.builder.voice'])}
                  onClick={() => {
                    toast.info(t(($) => $['skillManagement.detail.builder.voiceUnavailable']))
                  }}
                >
                  <span aria-hidden className="i-ri-mic-line size-4" />
                </TooltipTrigger>
                <TooltipContent placement="top">
                  {t(($) => $['skillManagement.detail.builder.voiceUnavailable'])}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                aria-label={t(($) => $['skillManagement.detail.builder.send'])}
                className="hover:bg-state-accent-solid-hover flex size-7 cursor-pointer items-center justify-center rounded-lg bg-state-accent-solid text-text-primary-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !canSendBuilderMessage ||
                  (!prompt.trim() && attachments.length === 0) ||
                  isSending ||
                  isUploadingAttachment
                }
                onClick={() => handleSend()}
              >
                <span
                  aria-hidden
                  className={cn(
                    isSending ? 'i-ri-loader-4-line animate-spin' : 'i-ri-arrow-up-line',
                    'size-4',
                  )}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
