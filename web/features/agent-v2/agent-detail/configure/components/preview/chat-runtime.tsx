'use client'

import type { AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode, Ref } from 'react'
import type { AgentChatMessageSender, AgentPreviewChatController } from './chat-conversation'
import type { AnswerActionPosition } from '@/app/components/base/chat/chat/answer/operation'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { getFormattedAgentDebugChatTree, getLastWorkflowRunId } from './chat-history'
import { AgentPreviewChatSession } from './chat-session'

export type AgentChatRuntimeEmptyStateProps = {
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  hasInstructions: boolean
}

export type AgentChatRuntimeProps = {
  agentId: string
  answerActionPosition?: AnswerActionPosition
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  controllerRef?: Ref<AgentPreviewChatController>
  conversationId?: string | null
  draftType?: 'debug_build'
  speechToTextDraftType?: 'draft' | 'debug_build'
  inputPlaceholder: string
  inputAutoFocus?: boolean
  sendButtonLabel?: string
  renderEmptyState: (props: AgentChatRuntimeEmptyStateProps) => ReactNode
  sendMessage: AgentChatMessageSender
  onClearChatListChange: (clearChatList: boolean) => void
  onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
  onConversationIdChange?: (conversationId: string) => void
  onWorkflowRunIdChange?: (workflowRunId: string | null) => void
  onBeforeSpeechToText?: () => Promise<unknown>
  onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
  onSendInterrupted?: () => void
}

export function AgentChatRuntime({
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
  draftType,
  speechToTextDraftType,
  inputPlaceholder,
  inputAutoFocus,
  sendButtonLabel,
  renderEmptyState,
  sendMessage,
  onClearChatListChange,
  onConversationComplete,
  onConversationIdChange,
  onWorkflowRunIdChange,
  onBeforeSpeechToText,
  onSendInterrupted,
  onSaveDraftBeforeRun,
}: AgentChatRuntimeProps) {
  const [currentSessionConversationId, setCurrentSessionConversationId] = useState<string | null>(
    null,
  )
  const handleClearChatListChange = useCallback(
    (nextClearChatList: boolean) => {
      if (!nextClearChatList) setCurrentSessionConversationId(null)
      onClearChatListChange(nextClearChatList)
    },
    [onClearChatListChange],
  )
  const historyQuery = useQuery(
    consoleQuery.agent.byAgentId.chatMessages.get.queryOptions({
      input: conversationId
        ? {
            params: {
              agent_id: agentId,
            },
            query: {
              conversation_id: conversationId,
            },
          }
        : skipToken,
    }),
  )
  const conversationBelongsToCurrentSession =
    !!conversationId && conversationId === currentSessionConversationId
  const initialChatTree = useMemo(
    () => getFormattedAgentDebugChatTree(historyQuery.data?.data ?? []),
    [historyQuery.data?.data],
  )
  useEffect(() => {
    if (!conversationId || !historyQuery.data) return

    onWorkflowRunIdChange?.(getLastWorkflowRunId(historyQuery.data.data ?? []))
  }, [conversationId, historyQuery.data, onWorkflowRunIdChange])

  if (conversationId && historyQuery.isPending && !conversationBelongsToCurrentSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="app" />
      </div>
    )
  }
  const inputSessionKey =
    !conversationId || conversationBelongsToCurrentSession ? 'current-session' : conversationId
  const conversationSessionKey =
    !conversationId || conversationBelongsToCurrentSession
      ? 'current-session'
      : `${conversationId}-${historyQuery.dataUpdatedAt}`

  return (
    <AgentPreviewChatSession
      key={inputSessionKey}
      conversationSessionKey={conversationSessionKey}
      agentId={agentId}
      answerActionPosition={answerActionPosition}
      agentIcon={agentIcon}
      agentIconBackground={agentIconBackground}
      agentIconType={agentIconType}
      agentName={agentName}
      agentSoulConfig={agentSoulConfig}
      clearChatList={clearChatList}
      controllerRef={controllerRef}
      conversationId={conversationId}
      draftType={draftType}
      speechToTextDraftType={speechToTextDraftType}
      initialChatTree={initialChatTree}
      inputPlaceholder={inputPlaceholder}
      inputAutoFocus={inputAutoFocus}
      sendButtonLabel={sendButtonLabel}
      renderEmptyState={renderEmptyState}
      sendMessage={sendMessage}
      onClearChatListChange={handleClearChatListChange}
      onConversationComplete={onConversationComplete}
      onConversationIdChange={onConversationIdChange}
      onCurrentSessionConversationIdChange={setCurrentSessionConversationId}
      onBeforeSpeechToText={onBeforeSpeechToText}
      onSendInterrupted={onSendInterrupted}
      onSaveDraftBeforeRun={onSaveDraftBeforeRun}
    />
  )
}
