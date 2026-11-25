'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode, Ref } from 'react'
import type {
  AgentChatMessageSender,
  AgentPreviewChatController,
  AgentPreviewChatConversationController,
  AgentPreviewChatRuntimeState,
} from './chat-conversation'
import type { AgentChatRuntimeEmptyStateProps, AgentChatRuntimeProps } from './chat-runtime'
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import type { AgentChatCutInSend } from '@/app/components/base/chat/use-agent-chat-cut-in'
import type { SpeechToTextTarget } from '@/app/components/base/voice-input/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChatInputArea from '@/app/components/base/chat/chat/chat-input-area'
import { useAgentChatCutIn } from '@/app/components/base/chat/use-agent-chat-cut-in'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { buildChatConfig, getAgentSoulInputs, getAgentSoulInputsForm } from './chat-config'
import { AgentPreviewChatConversation } from './chat-conversation'
import { useAgentRunSteering } from './use-agent-run-steering'

const chatMaxWidthClassName = 'max-w-150 min-[1920px]:max-w-200 min-[2560px]:max-w-240'

export function AgentPreviewChatSession({
  conversationSessionKey,
  agentId,
  answerActionPosition,
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
  agentName?: AgentChatRuntimeProps['agentName']
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
  const { t } = useTranslation(['agentV2'])
  const prompt = useAtomValue(agentComposerPromptAtom)
  const currentModel = useAtomValue(agentComposerModelAtom)
  const composerDraft = useAtomValue(agentComposerDraftAtom)
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
  const conversationRef = useRef<AgentPreviewChatConversationController>(null)
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
  const transport = useAgentRunSteering({ agentId })
  // Cut-in ("interrupt and continue"): while the scoped run is live, a
  // normal Send of new text freezes the inbox around that text, stops the
  // run, waits for its snapshot, starts one ordinary new turn in the same
  // conversation, and replays the frozen inputs FIFO.
  const sendTurn = useCallback<AgentChatCutInSend>(
    async (message, files, isRegenerate, parent) => {
      if (disabled) return false
      return conversationRef.current?.send(message, files, isRegenerate, parent)
    },
    [disabled],
  )
  const settleHandoff = useCallback(
    (taskId: string) => conversationRef.current?.settleHandoff(taskId) ?? false,
    [],
  )
  const cutIn = useAgentChatCutIn({
    enabled: !disabled,
    scopeKey: conversationSessionKey,
    isResponding: runtimeState.isResponding,
    transport,
    settle: settleHandoff,
    send: sendTurn,
  })
  useImperativeHandle(
    controllerRef,
    () => ({
      send: cutIn.send,
      stop: () => conversationRef.current?.stop(),
    }),
    [cutIn.send],
  )
  const { isEmptyChat, isResponding, isSendPending } = runtimeState
  const hasAgentConfiguration = !!(
    composerDraft.prompt.trim() ||
    composerDraft.skills.length ||
    composerDraft.files.length ||
    composerDraft.tools.length ||
    composerDraft.knowledgeRetrievals.length ||
    composerDraft.envVariables.length
  )
  const hasBuildNote = !!composerDraft.configNote.trim()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const sendButtonLoading =
    isEmptyChat && !!sendButtonLabel && (isSendPending || (isResponding && !cutIn.canSteer))
  const sandboxNotice = t(($) => $['agentDetail.configure.preview.sandboxNotice'])
  const sandboxNoticeTooltip = t(($) => $['agentDetail.configure.preview.sandboxNoticeTooltip'])
  const showSandboxNotice = isEmptyChat && !isSendPending && !isResponding
  const showUnconfiguredNotice = showSandboxNotice && !hasAgentConfiguration && !hasBuildNote
  const speechToTextTarget: SpeechToTextTarget = {
    type: 'agent',
    agentId,
    draftType: speechToTextDraftType ?? draftType ?? 'draft',
  }
  const chatInputNode = (
    <ChatInputArea
      botName={agentName || 'Agent'}
      customPlaceholder={inputPlaceholder}
      inputLabel={inputPlaceholder}
      disabled={disabled || (isEmptyChat && isResponding && !cutIn.canSteer)}
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- Build chat opts out so it does not steal focus from the configure editor.
      autoFocus={isEmptyChat ? inputAutoFocus : undefined}
      sendButtonLoading={sendButtonLoading}
      showFileUpload={false}
      visionConfig={config.file_upload}
      speechToTextConfig={config.speech_to_text}
      speechToTextTarget={speechToTextTarget}
      onBeforeSpeechToText={onBeforeSpeechToText}
      onSend={cutIn.send}
      inputs={inputs}
      inputsForm={inputsForm}
      isResponding={isEmptyChat ? undefined : isResponding && !cutIn.canSteer}
      sendButtonLabel={isEmptyChat ? sendButtonLabel : undefined}
      footerNotice={showSandboxNotice ? sandboxNotice : undefined}
      footerNoticeTooltip={
        showSandboxNotice && deploymentEdition === 'COMMUNITY' ? sandboxNoticeTooltip : undefined
      }
    />
  )

  return (
    <div
      className={cn(
        'relative mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden',
        chatMaxWidthClassName,
      )}
    >
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
          onAgentQueueReady={cutIn.onReady}
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
              ? cn('flex w-full flex-col items-start text-start', chatMaxWidthClassName)
              : 'pointer-events-none relative w-full',
          )}
        >
          {isEmptyChat && (
            <div className="w-full p-3 pb-0">
              {renderEmptyState({
                showUnconfiguredNotice,
              })}
            </div>
          )}
          <div className={cn(isEmptyChat && 'pointer-events-auto mt-5 w-full')}>
            {cutIn.sendFailed && (
              <p role="alert" className="mb-2 text-xs text-text-destructive">
                {t(($) => $['agentDetail.configure.preview.queue.sendFailed'])}
              </p>
            )}
            {chatInputNode}
          </div>
        </div>
      </div>
    </div>
  )
}
