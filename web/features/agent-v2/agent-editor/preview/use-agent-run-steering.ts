'use client'

import type { AgentChatCutInTransport } from '@/app/components/base/chat/use-agent-chat-cut-in'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'
import { consoleQuery } from '@/service/console'

/**
 * Console preview transport for the shared cut-in hook. Posts steering
 * inputs against the admitted preview run's scoped task binding: the
 * queue-ready SSE frame is the admission signal — a bound task id already
 * means this run opted in — and a 202 only means the inbox accepted the
 * input, not that the model consumed it. The interrupt call freezes the
 * inbox around the caller's text and settles the run server-side; its
 * receipt decides which inputs the next turn replays. `taskId` arrives per
 * call so a handoff stays retryable after the old run's SSE closed and the
 * active task unbound; replay ids are the frozen inputs' originals so
 * backend idempotency keeps retries of the same pair safe.
 */
export function useAgentRunSteering({ agentId }: { agentId: string }): AgentChatCutInTransport {
  const { mutateAsync: enqueueInput } = useMutation(
    consoleQuery.agent.byAgentId.chatMessages.byTaskId.inputs.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const { mutateAsync: interruptInput } = useMutation(
    consoleQuery.agent.byAgentId.chatMessages.byTaskId.inputs.byInputId.interrupt.post.mutationOptions(
      {
        context: { silent: true },
      },
    ),
  )

  return useMemo(
    () => ({
      interrupt: async (taskId, inputId, text) => {
        try {
          return await interruptInput({
            params: { agent_id: agentId, task_id: taskId, input_id: inputId },
            body: { text },
          })
        } catch {
          return null
        }
      },
      enqueue: async (taskId, inputId, text) => {
        try {
          await enqueueInput({
            params: { agent_id: agentId, task_id: taskId },
            body: { input_id: inputId, text },
          })
          return true
        } catch {
          return false
        }
      },
    }),
    [agentId, enqueueInput, interruptInput],
  )
}
