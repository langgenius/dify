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
  appId?: string
  conversationId?: string | null
  nodeId?: string
  queryClient: QueryClient
}) {
  if (appId && nodeId) {
    void queryClient.invalidateQueries({
      queryKey:
        consoleQuery.apps.byAppId.workflowRuns.byWorkflowRunId.agentNodes.byNodeId.sandbox.files.get.key(
          { type: 'query' },
        ),
    })
    return
  }

  if (!conversationId) return

  void queryClient.invalidateQueries({
    queryKey: consoleQuery.agent.byAgentId.sandbox.files.get.key({ type: 'query' }),
  })
}

type AgentWorkingDirectoryPanelInput =
  | {
      type: 'agent'
      agentId: string
      caller:
        | {
            type: 'build_draft'
            id?: string
          }
        | {
            type: 'conversation'
            id?: string | null
          }
    }
  | {
      type: 'workflow-node'
      appId?: string
      nodeId: string
      nodeExecutionId?: string
      workflowRunId?: string | null
    }

export function useAgentWorkingDirectoryPanel(input: AgentWorkingDirectoryPanelInput): {
  closeWorkingDirectory: () => void
  openWorkingDirectory: () => void
  panel: ReactNode
} {
  const [open, setOpen] = useState(false)
  let source: AgentWorkingDirectorySource | undefined
  if (input.type === 'workflow-node') {
    const { appId, nodeExecutionId, nodeId, workflowRunId } = input
    source =
      appId && nodeExecutionId && workflowRunId
        ? {
            type: 'workflow-node',
            appId,
            nodeId,
            nodeExecutionId,
            workflowRunId,
          }
        : undefined
  } else {
    const callerId = input.caller.id
    source = callerId
      ? {
          type: 'agent',
          agentId: input.agentId,
          callerType: input.caller.type,
          callerId,
        }
      : undefined
  }

  return {
    closeWorkingDirectory: () => setOpen(false),
    openWorkingDirectory: () => setOpen(true),
    panel: open && source ? (
      <AgentWorkingDirectoryPanel source={source} open={open} onOpenChange={setOpen} />
    ) : null,
  }
}
