'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import { AgentWorkingDirectoryPanel } from '../working-directory-panel'

export function invalidateAgentWorkingDirectoryFiles({
  conversationId,
  queryClient,
}: {
  agentId: string
  conversationId?: string | null
  queryClient: QueryClient
}) {
  if (!conversationId)
    return

  void queryClient.invalidateQueries({
    queryKey: consoleQuery.agent.byAgentId.sandbox.files.get.key({ type: 'query' }),
  })
}

export function useAgentWorkingDirectoryPanel({
  agentId,
  conversationId,
}: {
  agentId: string
  conversationId?: string | null
}): {
  closeWorkingDirectory: () => void
  openWorkingDirectory: () => void
  panel: ReactNode
} {
  const [open, setOpen] = useState(false)

  return {
    closeWorkingDirectory: () => setOpen(false),
    openWorkingDirectory: () => setOpen(true),
    panel: open
      ? (
          <AgentWorkingDirectoryPanel
            agentId={agentId}
            conversationId={conversationId}
            open={open}
            onOpenChange={setOpen}
          />
        )
      : null,
  }
}
