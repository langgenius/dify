'use client'

/* oxlint-disable eslint-react/set-state-in-effect -- The builder resets its local transcript when the authoritative detail snapshot changes. */

import type {
  SkillDetailResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { BuilderChatMessage, SkillBuilderAttachment, SkillBuilderModel } from './shared'
import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
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
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { sendSkillAssistMessage, uploadSkillFile } from '../client'
import { SkillBuilderGridTexture } from './builder-grid-texture'
import {
  findFileByPath,
  isAllowedSkillBuilderAttachment,
  isDefaultSkillBuilderDraft,
  isRecord,
  isTextFile,
  setSkillDetailCache,
  skillBuilderAttachmentAccept,
  skillBuilderMaxAttachmentBytes,
  skillBuilderMaxAttachments,
  skillBuilderMaxImageAttachmentBytes,
} from './shared'

const skillBuilderProgressStages = [
  'reading_draft',
  'generating_plan',
  'applying_changes',
  'updating_editor',
] as const

type SkillBuilderProgressStage = (typeof skillBuilderProgressStages)[number]

function isSkillBuilderProgressStage(stage: unknown): stage is SkillBuilderProgressStage {
  return (
    typeof stage === 'string' &&
    skillBuilderProgressStages.includes(stage as SkillBuilderProgressStage)
  )
}

function SkillBuilderProgressStageLabel({ stage }: { stage: SkillBuilderProgressStage }) {
  const { t } = useTranslation('skill')

  if (stage === 'reading_draft')
    return <>{t(($) => $['skillManagement.detail.builder.progress.readingDraft'])}</>
  if (stage === 'generating_plan')
    return <>{t(($) => $['skillManagement.detail.builder.progress.generatingPlan'])}</>
  if (stage === 'applying_changes')
    return <>{t(($) => $['skillManagement.detail.builder.progress.applyingChanges'])}</>
  return <>{t(($) => $['skillManagement.detail.builder.progress.updatingEditor'])}</>
}

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
    <div className="w-fit max-w-full min-w-0">
      {isLoading ? (
        <div className="h-6 w-20 rounded-md bg-state-base-hover" />
      ) : (
        <ModelSelector
          defaultModel={
            selectedModel
              ? { provider: selectedModel.provider, model: selectedModel.model }
              : undefined
          }
          modelList={modelList}
          popupClassName="h-[480px]! max-h-[480px]! w-80! max-w-80!"
          showModelMeta={false}
          triggerClassName="h-8! w-fit! max-w-full bg-transparent! p-1! hover:bg-state-base-hover! [&>div:first-child]:hidden [&>div:nth-child(2)]:px-0"
          onSelect={({ model, provider }) => {
            onSelect({
              ...selectedModel,
              provider,
              model,
            })
          }}
        />
      )}
    </div>
  )
}

function SkillBuilderThinkingMessage({
  progressStages,
  reasoningContent,
  seconds,
}: {
  progressStages?: string[]
  reasoningContent?: string
  seconds: number
}) {
  const { t } = useTranslation('skill')
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  const duration = minutes > 0 ? `${minutes}m${remainingSeconds}s` : `${remainingSeconds}s`
  const reasoning = reasoningContent?.trim()
  const visibleProgressStages = Array.from(new Set(progressStages ?? [])).filter(
    isSkillBuilderProgressStage,
  )
  const [open, setOpen] = useState(false)
  const content = (
    <>
      <span>{t(($) => $['skillManagement.detail.builder.thinking'])}</span>
      <span aria-hidden className="font-normal text-text-quaternary">
        ·
      </span>
      <span>{duration}</span>
    </>
  )

  return (
    <div className="px-1 text-text-tertiary">
      <button
        type="button"
        aria-expanded={open}
        className="flex h-6 cursor-pointer items-center gap-1 system-xs-medium outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => setOpen((current) => !current)}
      >
        {content}
        <span
          aria-hidden
          className={cn('i-ri-arrow-down-s-line size-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-background-section p-2 system-xs-regular text-text-secondary">
          {reasoning ? (
            <Markdown
              content={reasoning}
              className="text-[12px]! leading-[18px]! [&_p]:my-0 [&_p]:text-[12px]! [&_p]:leading-[18px]!"
            />
          ) : visibleProgressStages.length ? (
            <ol className="flex flex-col gap-1">
              {visibleProgressStages.map((stage) => (
                <li key={stage} className="flex items-center gap-2">
                  <span aria-hidden className="size-1.5 rounded-full bg-text-tertiary" />
                  <span>
                    <SkillBuilderProgressStageLabel stage={stage} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Markdown
              content={t(($) => $['skillManagement.detail.builder.thinkingUnavailable'])}
              className="text-[12px]! leading-[18px]! [&_p]:my-0 [&_p]:text-[12px]! [&_p]:leading-[18px]!"
            />
          )}
        </div>
      )}
    </div>
  )
}

function SkillBuilderMessageAttachments({
  attachments,
}: {
  attachments: SkillBuilderAttachment[]
}) {
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1.5">
      {attachments.map((attachment) =>
        attachment.previewUrl && attachment.mimeType.startsWith('image/') ? (
          <img
            key={attachment.id}
            src={attachment.previewUrl}
            alt={attachment.name}
            className="max-h-40 max-w-56 rounded-lg border border-divider-subtle object-contain"
          />
        ) : (
          <div
            key={attachment.id}
            className="flex max-w-56 items-center gap-2 rounded-lg border border-divider-subtle bg-background-default px-2.5 py-2 text-left text-text-secondary shadow-xs"
            title={attachment.name}
          >
            <span aria-hidden className="i-ri-file-line size-4 shrink-0 text-text-tertiary" />
            <span className="truncate system-xs-medium">{attachment.name}</span>
          </div>
        ),
      )}
    </div>
  )
}

const skillBuilderEmptyIconCellOpacities = [
  '0 0 0.093 0.166 0 0 0.155 0',
  '0 0.159 0.145 0.159 0.135 0.179 0.128 0.105',
  '0.091 0 0.161 0.187 0.102 0 0.111 0',
  '0.148 0.159 0 0 0.195 0.158 0.342 0.128',
  '0.169 0.132 0 0.115 0.112 0.319 0.218 0.199',
  '0.241 0.206 0.124 0.181 0.212 0.211 0.315 0.127',
  '0.133 0.21 0.166 0.476 0.167 0.22 0.136 0.246',
  '0 0.132 0.151 0.146 0.276 0.256 0.269 0',
].flatMap((row) => row.split(' ').map(Number))

const skillBuilderEmptyIconCells = skillBuilderEmptyIconCellOpacities.map((opacity, index) => ({
  id: `skill-builder-icon-cell-${Math.floor(index / 8)}-${index % 8}`,
  opacity,
}))

function SkillBuilderEmptyIcon() {
  return (
    <div className="dify-blue-glass-surface relative flex h-[50px] w-12 items-center justify-center rounded-xl p-2 shadow-lg backdrop-blur-[5px]">
      <div
        aria-hidden
        className="absolute inset-x-px inset-y-0.5 grid grid-cols-[repeat(8,4px)] grid-rows-[repeat(8,4px)] gap-0.5 opacity-25"
      >
        {skillBuilderEmptyIconCells.map((cell) => (
          <span
            key={cell.id}
            className={cell.opacity > 0 ? 'rounded-[1px] bg-[#98A2B2]' : 'invisible'}
            style={{ opacity: cell.opacity }}
          />
        ))}
      </div>
      <span
        aria-hidden
        className="relative i-custom-vender-agent-v2-building-blocks size-5 text-[#0033FF] drop-shadow-[0_0_4px_rgba(49,70,255,0.18)]"
      />
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
  const attachmentUploadGenerationRef = useRef(0)
  const [isSending, setIsSending] = useState(false)
  const [thinkingElapsedSeconds, setThinkingElapsedSeconds] = useState(0)
  const thinkingElapsedSecondsRef = useRef(0)
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
  const replaceAssistantMessageWithError = (assistantMessageId: string, errorMessage: string) => {
    rawAssistantMessagesRef.current.set(assistantMessageId, errorMessage)
    updateMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              content: errorMessage,
              rawContent: errorMessage,
              tone: 'error',
            }
          : message,
      ),
    )
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
      attachmentUploadGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!isSending) return

    const timer = window.setInterval(() => {
      setThinkingElapsedSeconds((currentSeconds) => {
        const nextSeconds = currentSeconds + 1
        thinkingElapsedSecondsRef.current = nextSeconds
        return nextSeconds
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isSending])

  const handleRestart = () => {
    assistAbortControllerRef.current?.abort()
    assistAbortControllerRef.current = null
    attachmentUploadGenerationRef.current += 1
    setPrompt('')
    messagesRef.current = initialMessages
    rawAssistantMessagesRef.current.clear()
    setMessages(initialMessages)
    setAttachments([])
    setIsUploadingAttachment(false)
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    setIsSending(false)
    setThinkingElapsedSeconds(0)
    thinkingElapsedSecondsRef.current = 0
    isSendingRef.current = false
  }

  const handleClose = () => {
    assistAbortControllerRef.current?.abort()
    assistAbortControllerRef.current = null
    attachmentUploadGenerationRef.current += 1
    isSendingRef.current = false
    setIsSending(false)
    setThinkingElapsedSeconds(0)
    thinkingElapsedSecondsRef.current = 0
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
    if (attachments.length >= skillBuilderMaxAttachments) {
      toast.error(t(($) => $['skillManagement.detail.builder.attachLimit']))
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      return
    }
    const maxBytes = file.type.startsWith('image/')
      ? skillBuilderMaxImageAttachmentBytes
      : skillBuilderMaxAttachmentBytes
    if (file.size > maxBytes) {
      toast.error(t(($) => $['skillManagement.detail.builder.attachTooLarge']))
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      return
    }
    if (!isAllowedSkillBuilderAttachment(file)) {
      toast.error(t(($) => $['skillManagement.detail.builder.attachUnsupported']))
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      return
    }

    setIsUploadingAttachment(true)
    const uploadGeneration = attachmentUploadGenerationRef.current
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    try {
      const uploadedFile = await uploadSkillFile(file)
      if (uploadGeneration !== attachmentUploadGenerationRef.current) {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        return
      }

      setAttachments((currentAttachments) => [
        ...currentAttachments,
        {
          id: uploadedFile.id,
          mimeType: uploadedFile.mime_type || file.type || 'application/octet-stream',
          name: uploadedFile.name || file.name,
          previewUrl,
          size: uploadedFile.size ?? file.size,
          toolFileId: uploadedFile.id,
        },
      ])
    } catch (error) {
      if (uploadGeneration !== attachmentUploadGenerationRef.current) {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        return
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['skillManagement.detail.builder.attachFailed']),
      )
    } finally {
      if (uploadGeneration === attachmentUploadGenerationRef.current) {
        setIsUploadingAttachment(false)
        if (attachmentInputRef.current) attachmentInputRef.current.value = ''
      }
    }
  }

  const removeAttachment = (attachmentId: string) => {
    setAttachments((currentAttachments) => {
      const attachment = currentAttachments.find((item) => item.id === attachmentId)
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      return currentAttachments.filter((item) => item.id !== attachmentId)
    })
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

  const handleSend = (
    messageText = prompt,
    messageAttachments: SkillBuilderAttachment[] = attachments,
  ) => {
    const trimmedPrompt = messageText.trim()
    const attachedFiles = messageAttachments
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
    const conversationHistory = messagesRef.current
      .filter((message) => message.content.trim() && message.id !== `assistant-${skillId}-intro`)
      .slice(-12)
      .map(({ content, role, suggestedDisplayName, suggestedName }) => ({
        content,
        role,
        suggested_display_name: suggestedDisplayName,
        suggested_name: suggestedName,
      }))

    const userMessage: BuilderChatMessage = {
      attachments: attachedFiles,
      id: `user-${Date.now()}`,
      role: 'user',
      content: requestMessage,
    }
    const assistantMessageId = `assistant-${Date.now()}`
    const assistantMessage: BuilderChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      thinkingDurationSeconds: 0,
    }

    updateMessages((currentMessages) => [
      ...currentMessages
        .map((message) => ({ ...message, suggestions: undefined }))
        .filter(
          (message) =>
            message.id !== `assistant-${skillId}-intro` ||
            currentMessages.some((currentMessage) => currentMessage.role === 'user'),
        ),
      userMessage,
      assistantMessage,
    ])
    setPrompt('')
    setAttachments([])
    setIsSending(true)
    setThinkingElapsedSeconds(0)
    thinkingElapsedSecondsRef.current = 0

    void sendSkillAssistMessage({
      skillId,
      history: conversationHistory,
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
        if (event.event === 'skill_assistant_progress') {
          const stage = event.stage
          if (!isSkillBuilderProgressStage(stage)) return

          updateMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    progressStages: [...(message.progressStages ?? []), stage],
                  }
                : message,
            ),
          )
          return
        }
        if (event.event === 'skill_assistant_reasoning_chunk') {
          const reasoning = typeof event.reasoning === 'string' ? event.reasoning : ''
          if (!reasoning) return

          updateMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    reasoningContent: `${message.reasoningContent ?? ''}${reasoning}`,
                  }
                : message,
            ),
          )
          return
        }
        if (event.event === 'skill_assistant_name_suggestion') {
          const suggestedName = typeof event.name === 'string' ? event.name : undefined
          const suggestedDisplayName =
            typeof event.display_name === 'string' ? event.display_name : undefined
          if (!suggestedName && !suggestedDisplayName) return
          updateMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessageId
                ? { ...message, suggestedName, suggestedDisplayName }
                : message,
            ),
          )
          return
        }
        if (event.event === 'skill_assistant_suggestions') {
          const nextSuggestions = Array.isArray(event.suggestions)
            ? event.suggestions.filter(
                (suggestion): suggestion is string => typeof suggestion === 'string',
              )
            : []
          updateMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    suggestions: nextSuggestions,
                  }
                : message,
            ),
          )
          return
        }
        if (event.event !== 'skill_detail_updated' || !isRecord(event.detail)) return

        const nextDetail = event.detail as SkillDetailResponse
        detailRef.current = nextDetail
        setSkillDetailCache(queryClient, skillId, nextDetail)
        onDraftDetailChange(nextDetail)
      },
      onCompleted: (hasError, errorMessage) => {
        const thinkingDurationSeconds = thinkingElapsedSecondsRef.current
        updateMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessageId ? { ...message, thinkingDurationSeconds } : message,
          ),
        )
        setIsSending(false)
        setThinkingElapsedSeconds(0)
        thinkingElapsedSecondsRef.current = 0
        isSendingRef.current = false
        assistAbortControllerRef.current = null
        if (hasError && errorMessage) {
          replaceAssistantMessageWithError(assistantMessageId, errorMessage)
          toast.error(errorMessage)
        }
      },
      onError: (errorMessage) => {
        const thinkingDurationSeconds = thinkingElapsedSecondsRef.current
        updateMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessageId ? { ...message, thinkingDurationSeconds } : message,
          ),
        )
        setIsSending(false)
        setThinkingElapsedSeconds(0)
        thinkingElapsedSecondsRef.current = 0
        isSendingRef.current = false
        assistAbortControllerRef.current = null
        if (errorMessage) {
          replaceAssistantMessageWithError(assistantMessageId, errorMessage)
          toast.error(errorMessage)
        }
      },
    }).catch((error: unknown) => {
      const thinkingDurationSeconds = thinkingElapsedSecondsRef.current
      updateMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId ? { ...message, thinkingDurationSeconds } : message,
        ),
      )
      setIsSending(false)
      setThinkingElapsedSeconds(0)
      thinkingElapsedSecondsRef.current = 0
      isSendingRef.current = false
      assistAbortControllerRef.current = null
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['skillManagement.detail.builder.sendFailed']),
      )
    })
  }

  const handleCopyMessage = async (content: string) => {
    await navigator.clipboard.writeText(content)
    toast.success(t(($) => $['skillManagement.detail.builder.copySuccess']))
  }

  const handleReadMessage = (content: string) => {
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(content))
  }

  const handleRetryMessage = (messageIndex: number) => {
    const previousUserMessage = messages
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === 'user')
    if (previousUserMessage)
      handleSend(previousUserMessage.content, previousUserMessage.attachments ?? [])
  }

  return (
    <aside className="relative my-1 mr-1 flex w-[396px] shrink-0 flex-col overflow-hidden rounded-lg inset-ring-[0.5px] inset-ring-divider-subtle">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2"
      />
      <SkillBuilderGridTexture
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-[2]"
      />
      <SkillBuilderGridTexture
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 z-[1] origin-center scale-y-[-1]"
      />
      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-2 pr-3 pl-4">
        <h2 className="system-xs-semibold-uppercase text-text-secondary">
          {t(($) => $['skillManagement.detail.builder.title'])}
        </h2>
        <div className="flex h-8 items-center gap-1">
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.builder.restart'])}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={handleRestart}
          >
            <span aria-hidden className="i-ri-restart-line size-4" />
          </button>
          <span aria-hidden className="flex h-8 w-[9px] items-center justify-center">
            <span className="h-3.5 w-px bg-divider-subtle" />
          </span>
          <button
            type="button"
            aria-label={t(($) => $['skillManagement.detail.builder.close'])}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={handleClose}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </div>
      <div
        className={cn(
          'relative z-10 flex min-h-0 flex-1 flex-col',
          messages.length === 0 && 'justify-center',
        )}
      >
        <div
          className={cn(
            'min-h-0 scrollbar-thin overflow-y-auto px-4 pt-4 pb-[11px]',
            messages.length > 0 ? 'flex-1' : 'shrink-0',
          )}
        >
          {messages.length > 0 ? (
            <div className="flex flex-col gap-3">
              {messages.map((message, messageIndex) =>
                message.role === 'user' ? (
                  <div
                    key={message.id}
                    className="flex w-full max-w-[720px] flex-col items-end gap-1 self-end pl-8"
                  >
                    {!!message.attachments?.length && (
                      <SkillBuilderMessageAttachments attachments={message.attachments} />
                    )}
                    <div className="flex max-w-72 flex-col items-end rounded-2xl bg-background-default-dimmed px-2 py-2">
                      <Markdown
                        content={message.content}
                        className="px-2 py-1 text-[14px]! leading-[20px]! tracking-[-0.07px] [&_p]:my-0 [&_p]:text-[14px]! [&_p]:leading-[20px]!"
                      />
                    </div>
                    <div aria-hidden className="h-4 w-full" />
                  </div>
                ) : (
                  <div
                    key={message.id}
                    className={cn(
                      'flex w-full max-w-[720px] flex-col items-start gap-1 text-text-secondary',
                      message.tone === 'error' &&
                        'rounded-xl border border-state-destructive-border bg-state-destructive-hover px-3 py-2 text-text-destructive',
                    )}
                  >
                    {message.thinkingDurationSeconds !== undefined && (
                      <SkillBuilderThinkingMessage
                        progressStages={message.progressStages}
                        reasoningContent={message.reasoningContent}
                        seconds={
                          isSending && messageIndex === messages.length - 1
                            ? thinkingElapsedSeconds
                            : message.thinkingDurationSeconds
                        }
                      />
                    )}
                    {message.content ? (
                      <>
                        <Markdown
                          content={message.content}
                          className="px-1 text-[14px]! leading-[20px]! tracking-[-0.07px] [&_p]:my-0 [&_p]:text-[14px]! [&_p]:leading-[20px]! [&_p+p]:mt-2"
                        />
                        <div className="mt-1 flex h-7 items-center gap-0.5 px-0.5 text-text-tertiary">
                          <button
                            type="button"
                            aria-label={t(($) => $['skillManagement.detail.builder.readAloud'])}
                            className="flex size-7 cursor-pointer items-center justify-center rounded-md outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                            onClick={() => handleReadMessage(message.content)}
                          >
                            <span aria-hidden className="i-ri-volume-up-line size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t(($) => $['skillManagement.detail.builder.copyResponse'])}
                            className="flex size-7 cursor-pointer items-center justify-center rounded-md outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                            onClick={() => void handleCopyMessage(message.content)}
                          >
                            <span aria-hidden className="i-ri-clipboard-line size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t(($) => $['skillManagement.detail.builder.retryResponse'])}
                            className="flex size-7 cursor-pointer items-center justify-center rounded-md outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-30"
                            disabled={
                              isSending ||
                              !messages
                                .slice(0, messageIndex)
                                .some((currentMessage) => currentMessage.role === 'user')
                            }
                            onClick={() => handleRetryMessage(messageIndex)}
                          >
                            <span aria-hidden className="i-ri-restart-line size-4" />
                          </button>
                        </div>
                        {!!message.suggestions?.length && (
                          <div className="mt-3 flex w-full flex-wrap items-end justify-end gap-1 py-2">
                            {message.suggestions.map((suggestion) => (
                              <button
                                key={suggestion}
                                type="button"
                                className="max-w-full cursor-pointer rounded-md border-[0.5px] border-divider-subtle bg-background-default px-2 py-1 text-right system-xs-medium text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={
                                  isSending || isUploadingAttachment || !canSendBuilderMessage
                                }
                                onClick={() => handleSend(suggestion)}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : message.thinkingDurationSeconds === undefined ? (
                      <SkillBuilderThinkingMessage
                        progressStages={message.progressStages}
                        reasoningContent={message.reasoningContent}
                        seconds={thinkingElapsedSeconds}
                      />
                    ) : null}
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 px-3 text-left">
              <div className="flex flex-col items-start gap-3">
                <SkillBuilderEmptyIcon />
                <div className="flex w-full flex-col gap-1">
                  <h3 className="system-md-medium text-text-secondary">
                    {t(($) => $['skillManagement.detail.builder.promptTitle'])}
                  </h3>
                  <p className="body-sm-regular text-text-tertiary">
                    {t(($) => $['skillManagement.detail.builder.promptDescription'])}
                  </p>
                </div>
              </div>
              <div className="space-y-2 pt-3">
                <div className="flex items-center gap-2">
                  <p className="shrink-0 system-2xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['skillManagement.detail.builder.tryExample'])}
                  </p>
                  <span aria-hidden className="h-px flex-1 bg-divider-subtle" />
                </div>
                <div className="flex flex-wrap items-start gap-1">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="inline-flex min-h-6 max-w-full cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1.5 py-1 text-left shadow-xs outline-hidden hover:bg-components-button-secondary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSending || isUploadingAttachment || !canSendBuilderMessage}
                      onClick={() => handleSend(suggestion)}
                    >
                      <span className="truncate px-1.5 system-xs-medium text-components-button-secondary-text">
                        {suggestion}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          className={cn(
            'relative flex shrink-0 items-end justify-end px-4 pt-3 pb-4',
            messages.length > 0 &&
              'bg-gradient-to-b from-components-chat-input-bg-mask-1 to-components-chat-input-bg-mask-2',
          )}
        >
          <div className="flex w-full flex-col items-end justify-end">
            <div className="relative flex w-full flex-col items-start overflow-hidden rounded-xl border border-components-chat-input-border bg-background-default p-3 shadow-lg">
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
                        className="i-ri-attachment-line size-3.5 shrink-0 text-text-tertiary"
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
                rows={1}
                className="[field-sizing:content] max-h-40 min-h-6 w-full resize-none bg-transparent px-0 py-0 body-md-regular text-text-secondary outline-hidden placeholder:text-text-quaternary"
                placeholder={inputPlaceholder}
                disabled={isSending}
                onChange={(event) => setPrompt(event.target.value)}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey)
                    return
                  if (event.nativeEvent.isComposing || isComposingRef.current) return

                  event.preventDefault()
                  handleSend()
                }}
              />
              <div className="mt-3 flex min-h-8 w-full min-w-0 items-center justify-between gap-2">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <BuilderModelSelector
                    isLoading={isTextGenerationModelListLoading}
                    modelList={textGenerationModelList}
                    selectedModel={activeSelectedModel}
                    onSelect={setSelectedModel}
                  />
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={t(($) => $['skillManagement.detail.builder.attach'])}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSending || isUploadingAttachment}
                      onClick={() => attachmentInputRef.current?.click()}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          isUploadingAttachment
                            ? 'i-ri-loader-4-line animate-spin'
                            : 'i-ri-attachment-line',
                          'size-4',
                        )}
                      />
                    </button>
                  </div>
                  <Button
                    aria-label={t(($) => $['skillManagement.detail.builder.send'])}
                    variant="primary"
                    className="size-8 px-0 focus-visible:ring-inset"
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
                        isSending
                          ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                          : 'i-ri-send-plane-2-fill',
                        'size-4',
                      )}
                    />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
