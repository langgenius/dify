'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureConversationIds } from '../right-panel-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { consoleQuery } from '@/service/client'

type DebugConversationRefreshInput = {
  params: {
    agent_id: string
  }
  body: {
    debug_conversation_id: string
  }
}

export function useAgentConfigureChat({
  agentId,
  initialDebugConversationId,
}: {
  agentId: string
  initialDebugConversationId?: string | null
}) {
  const queryClient = useQueryClient()
  const [clearPreviewChat, setClearPreviewChat] = useState(false)
  const [conversationIds, setConversationIds] = useState<AgentConfigureConversationIds>({
    build: initialDebugConversationId ?? null,
    preview: null,
  })
  const refreshDebugConversationMutation = useMutation(consoleQuery.agent.byAgentId.debugConversation.refresh.post.mutationOptions({
    onSuccess: ({ debug_conversation_id }) => {
      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
        (agentDetail) => {
          if (!agentDetail)
            return agentDetail

          return {
            ...agentDetail,
            debug_conversation_id,
          }
        },
      )
    },
  }))
  const {
    mutate: refreshDebugConversationRequest,
    mutateAsync: refreshDebugConversationRequestAsync,
    isPending: isRefreshingDebugConversation,
  } = refreshDebugConversationMutation
  const refreshDebugConversationInput = useCallback((conversationId: string): DebugConversationRefreshInput => ({
    params: {
      agent_id: agentId,
    },
    body: {
      debug_conversation_id: conversationId,
    },
  }), [agentId])
  const refreshDebugConversation = useCallback((conversationId: string) => {
    const input = refreshDebugConversationInput(conversationId)

    refreshDebugConversationRequest(
      input as unknown as Parameters<typeof refreshDebugConversationRequest>[0],
    )
  }, [refreshDebugConversationInput, refreshDebugConversationRequest])
  const refreshDebugConversationAsync = useCallback((conversationId: string) => {
    const input = refreshDebugConversationInput(conversationId)

    return refreshDebugConversationRequestAsync(
      input as unknown as Parameters<typeof refreshDebugConversationRequestAsync>[0],
    )
  }, [refreshDebugConversationInput, refreshDebugConversationRequestAsync])
  const resetBuildChatSession = useCallback(async () => {
    try {
      await refreshDebugConversationAsync(conversationIds.build ?? '')
    }
    finally {
      setConversationIds(current => ({
        ...current,
        build: null,
      }))
      setClearPreviewChat(true)
    }
  }, [conversationIds.build, refreshDebugConversationAsync])

  return {
    clearPreviewChat,
    conversationIds,
    isRefreshingDebugConversation,
    refreshDebugConversation,
    resetBuildChatSession,
    setClearPreviewChat,
    setConversationIds,
  }
}
