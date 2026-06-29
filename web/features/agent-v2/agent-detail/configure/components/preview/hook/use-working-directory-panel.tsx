'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AgentWorkingDirectorySource } from '../working-directory-panel'
import { useState } from 'react'
import { consoleQuery } from '@/service/client'
import { AgentWorkingDirectoryPanel } from '../working-directory-panel'

export function invalidateAgentWorkingDirectoryFiles({
  appId,
  conversationId,
  nodeId,
  queryClient,
}: {
  agentId: string
  appId?: string
  conversationId?: string | null
  nodeId?: string
  queryClient: QueryClient
  workflowRunId?: string | null
}) {
  if (appId && nodeId) {
    void queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.get.key({ type: 'query' }),
    })
    return
  }

  if (!conversationId)
    return

  void queryClient.invalidateQueries({
    queryKey: consoleQuery.agent.byAgentId.sandbox.files.get.key({ type: 'query' }),
  })
}

export function useAgentWorkingDirectoryPanel({
  agentId,
  appId,
  conversationId,
  nodeId,
  workflowRunId,
}: {
  agentId: string
  appId?: string
  conversationId?: string | null
  nodeId?: string
  workflowRunId?: string | null
}): {
  closeWorkingDirectory: () => void
  openWorkingDirectory: () => void
  panel: ReactNode
} {
  const [open, setOpen] = useState(false)
  const source: AgentWorkingDirectorySource = appId && nodeId
    ? {
        type: 'workflow-node',
        appId,
        conversationId,
        nodeId,
        workflowRunId,
      }
    : {
        type: 'agent',
        agentId,
        conversationId,
      }

  return {
    closeWorkingDirectory: () => setOpen(false),
    openWorkingDirectory: () => setOpen(true),
    panel: open
      ? (
          <AgentWorkingDirectoryPanel
            source={source}
            open={open}
            onOpenChange={setOpen}
          />
        )
      : null,
  }
}
