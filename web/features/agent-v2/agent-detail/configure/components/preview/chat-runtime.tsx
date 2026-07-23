'use client'

import type { AgentIconType, AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { getFormattedAgentDebugChatTree } from './chat-history'
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
  agentIcon?: string | null
  agentIconBackground?: string | null
  agentIconType?: AgentIconType | null
  agentName?: string
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  conversationId?: string | null
  draftType?: 'debug_build'
  inputPlaceholder: string
  inputAutoFocus?: boolean
  sendButtonLabel?: string
  renderEmptyState: (props: AgentChatRuntimeEmptyStateProps) => ReactNode
  onClearChatListChange: (clearChatList: boolean) => void
  onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
  onConversationIdChange?: (conversationId: string) => void
  onBeforeSpeechToText?: () => Promise<unknown>
  onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
  onSendInterrupted?: () => void
}

export function AgentChatRuntime({
  agentId,
  agentIcon,
  agentIconBackground,
  agentIconType,
  agentName,
  agentSoulConfig,
  clearChatList,
  conversationId,
  draftType,
  inputPlaceholder,
  inputAutoFocus,
  sendButtonLabel,
  renderEmptyState,
  onClearChatListChange,
  onConversationComplete,
  onConversationIdChange,
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
      agentIcon={agentIcon}
      agentIconBackground={agentIconBackground}
      agentIconType={agentIconType}
      agentName={agentName}
      agentSoulConfig={agentSoulConfig}
      clearChatList={clearChatList}
      conversationId={conversationId}
      draftType={draftType}
      initialChatTree={initialChatTree}
      inputPlaceholder={inputPlaceholder}
      inputAutoFocus={inputAutoFocus}
      sendButtonLabel={sendButtonLabel}
      renderEmptyState={renderEmptyState}
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
