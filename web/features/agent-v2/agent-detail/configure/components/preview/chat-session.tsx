'use client'

import type { AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode, Ref } from 'react'
import type {
  AgentChatMessageSender,
  AgentPreviewChatController,
  AgentPreviewChatRuntimeState,
} from './chat-conversation'
import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import type { ChatItem, ChatItemInTree, OnSend } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { SpeechToTextTarget } from '@/app/components/base/voice-input/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChatInputArea from '@/app/components/base/chat/chat/chat-input-area'
import { IS_CE_EDITION } from '@/config'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { buildChatConfig, getAgentSoulInputs, getAgentSoulInputsForm } from './chat-config'
import { AgentPreviewChatConversation } from './chat-conversation'

export function AgentPreviewChatSession({
  conversationSessionKey,
  agentId,
  answerActionPosition,
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  agentSoulConfig,
  clearChatList,
  controllerRef,
  conversationId,
  disabled,
  draftType,
  speechToTextDraftType,
  initialChatTree,
  inputPlaceholder,
  inputAutoFocus,
  sendButtonLabel,
  renderEmptyState,
  sendMessage,
  onClearChatListChange,
  onConversationComplete,
  onConversationIdChange,
  onCurrentSessionConversationIdChange,
  onBeforeSpeechToText,
  onSendInterrupted,
  onSaveDraftBeforeRun,
}: {
  conversationSessionKey: string
  agentId: string
  answerActionPosition?: AgentChatRuntimeProps['answerActionPosition']
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  controllerRef?: Ref<AgentPreviewChatController>
  conversationId?: string | null
  disabled?: boolean
  draftType?: 'debug_build'
  speechToTextDraftType?: 'draft' | 'debug_build'
  initialChatTree: ChatItemInTree[]
  inputPlaceholder: string
  inputAutoFocus?: boolean
  sendButtonLabel?: string
  renderEmptyState: (props: AgentChatRuntimeEmptyStateProps) => ReactNode
  sendMessage: AgentChatMessageSender
  onClearChatListChange: (clearChatList: boolean) => void
  onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
  onConversationIdChange?: (conversationId: string) => void
  onCurrentSessionConversationIdChange: (conversationId: string) => void
  onBeforeSpeechToText?: () => Promise<unknown>
  onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
  onSendInterrupted?: () => void
}) {
  const { t } = useTranslation('agentV2')
  const prompt = useAtomValue(agentComposerPromptAtom)
  const currentModel = useAtomValue(agentComposerModelAtom)
  const config = useMemo(
    () =>
      buildChatConfig({
        agentSoulConfig,
        currentModel,
        prompt,
      }),
    [agentSoulConfig, currentModel, prompt],
  )
  const inputsForm = useMemo(() => getAgentSoulInputsForm(agentSoulConfig), [agentSoulConfig])
  const inputs = useMemo(() => getAgentSoulInputs(inputsForm), [inputsForm])
  const conversationRef = useRef<AgentPreviewChatController>(null)
  const [runtimeState, setRuntimeState] = useState<AgentPreviewChatRuntimeState>(() => ({
    isEmptyChat: initialChatTree.length === 0 && !config.opening_statement,
    isResponding: false,
    isSendPending: false,
  }))
  const handleRuntimeStateChange = useCallback((nextState: AgentPreviewChatRuntimeState) => {
    setRuntimeState((currentState) => {
      if (
        currentState.isEmptyChat === nextState.isEmptyChat &&
        currentState.isResponding === nextState.isResponding &&
        currentState.isSendPending === nextState.isSendPending
      )
        return currentState

      return nextState
    })
  }, [])
  const handleInputSend: OnSend = useCallback(
    (
      message: string,
      files?: FileEntity[],
      isRegenerate: boolean = false,
      parentAnswer: ChatItem | null = null,
    ) => {
      if (disabled) return
      return conversationRef.current?.send(message, files, isRegenerate, parentAnswer)
    },
    [disabled],
  )
  useImperativeHandle(
    controllerRef,
    () => ({
      send: handleInputSend,
      stop: () => conversationRef.current?.stop(),
    }),
    [handleInputSend],
  )
  const { isEmptyChat, isResponding, isSendPending } = runtimeState
  const hasInstructions = !!config.pre_prompt.trim()
  const sendButtonLoading = isEmptyChat && !!sendButtonLabel && (isSendPending || isResponding)
  const sandboxNotice = t(($) => $['agentDetail.configure.preview.sandboxNotice'])
  const sandboxNoticeTooltip = t(($) => $['agentDetail.configure.preview.sandboxNoticeTooltip'])
  const showSandboxNotice = isEmptyChat && !isSendPending && !isResponding
  const speechToTextTarget: SpeechToTextTarget = {
    type: 'agent',
    agentId,
    draftType: speechToTextDraftType ?? draftType ?? 'draft',
  }
  const chatInputNode = (
    <ChatInputArea
      botName={agentName || 'Agent'}
      customPlaceholder={inputPlaceholder}
      disabled={disabled || (isEmptyChat && isResponding)}
      // Build chat opts out so it does not steal focus from the configure editor.
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={isEmptyChat ? inputAutoFocus : undefined}
      sendButtonLoading={sendButtonLoading}
      showFileUpload={false}
      visionConfig={config.file_upload}
      speechToTextConfig={config.speech_to_text}
      speechToTextTarget={speechToTextTarget}
      onBeforeSpeechToText={onBeforeSpeechToText}
      onSend={handleInputSend}
      inputs={inputs}
      inputsForm={inputsForm}
      isResponding={isEmptyChat ? undefined : isResponding}
      sendButtonLabel={isEmptyChat ? sendButtonLabel : undefined}
      footerNotice={showSandboxNotice ? sandboxNotice : undefined}
      footerNoticeTooltip={showSandboxNotice && IS_CE_EDITION ? sandboxNoticeTooltip : undefined}
    />
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <AgentPreviewChatConversation
          key={conversationSessionKey}
          ref={conversationRef}
          agentId={agentId}
          answerActionPosition={answerActionPosition}
          agentSoulConfig={agentSoulConfig}
          clearChatList={clearChatList}
          config={config}
          conversationId={conversationId}
          currentModel={currentModel}
          draftType={draftType}
          initialChatTree={initialChatTree}
          inputs={inputs}
          inputsForm={inputsForm}
          sendButtonLabel={sendButtonLabel}
          sendMessage={sendMessage}
          speechToTextTarget={speechToTextTarget}
          onBeforeSpeechToText={onBeforeSpeechToText}
          onClearChatListChange={onClearChatListChange}
          onConversationComplete={onConversationComplete}
          onConversationIdChange={onConversationIdChange}
          onCurrentSessionConversationIdChange={onCurrentSessionConversationIdChange}
          onRuntimeStateChange={handleRuntimeStateChange}
          onSaveDraftBeforeRun={onSaveDraftBeforeRun}
          onSendInterrupted={onSendInterrupted}
        />
      </div>
      <div
        data-testid={isEmptyChat ? undefined : 'agent-chat-footer'}
        className={cn(
          'z-10 shrink-0',
          isEmptyChat ? 'absolute inset-0 flex items-center justify-center' : 'relative px-3 pb-2',
        )}
      >
        <div
          className={cn(
            isEmptyChat
              ? 'flex w-full max-w-150 flex-col items-start p-3 text-left'
              : 'pointer-events-none relative w-full',
          )}
        >
          {isEmptyChat &&
            renderEmptyState({
              agentIcon,
              agentIconBackground,
              agentIconType,
              agentName,
              hasInstructions,
            })}
          <div className={cn(isEmptyChat && 'pointer-events-auto mt-5 w-full')}>
            {chatInputNode}
          </div>
        </div>
      </div>
    </div>
  )
}
