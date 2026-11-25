'use client'

import type { RunQueueEntry } from '@dify/contracts/api/console/agent/types.gen'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { v4 as uuid4 } from 'uuid'
import { consoleQuery } from '@/service/console'

const MAX_STEERING_TEXT_LENGTH = 8000

type SteeringAttempt = {
  taskId: string
  text: string
  inputId: string
}

export type AgentRunQueue = {
  entries: RunQueueEntry[]
  canSteer: boolean
  sendFailed: boolean
  textByInputId: Record<string, string>
  steer: (text: string) => Promise<boolean>
}

/**
 * Polls the admitted preview run's steering queue while a run id is bound to
 * the public task id, and posts steering inputs against the same binding.
 * The hook never sees or stores a backend run id.
 */
export function useAgentRunQueue({
  agentId,
  taskId,
}: {
  agentId: string
  taskId: string | null
}): AgentRunQueue {
  const query = useQuery(
    consoleQuery.agent.byAgentId.chatMessages.byTaskId.queue.get.queryOptions({
      input: taskId ? { params: { agent_id: agentId, task_id: taskId } } : skipToken,
      context: { silent: true },
      retry: false,
      refetchInterval: taskId ? 1000 : false,
    }),
  )
  const enqueue = useMutation(
    consoleQuery.agent.byAgentId.chatMessages.byTaskId.inputs.post.mutationOptions({
      context: { silent: true },
    }),
  )

  // Synchronous in-flight guard: a queued input must never be submitted twice
  // within the same turn.
  const inflightRef = useRef(false)
  // Reuses the accepted-or-not input id when the same trimmed draft is retried,
  // keeping backend idempotency effective after network errors.
  const retryRef = useRef<SteeringAttempt | null>(null)
  const [textByInputId, setTextByInputId] = useState<Record<string, string>>({})
  // Scoped to the task that produced it so a stale failure is not shown on the
  // next turn.
  const [sendError, setSendError] = useState<{ taskId: string } | null>(null)

  const entries = query.data?.entries ?? []
  const canSteer = !!taskId && query.data?.accepting_inputs === true
  const sendFailed = sendError?.taskId === taskId

  const steer = async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (
      !taskId ||
      !canSteer ||
      !trimmed ||
      trimmed.length > MAX_STEERING_TEXT_LENGTH ||
      inflightRef.current
    )
      return false

    inflightRef.current = true
    const pending = retryRef.current
    const attempt: SteeringAttempt =
      pending && pending.taskId === taskId && pending.text === trimmed
        ? pending
        : { taskId, text: trimmed, inputId: uuid4() }

    try {
      const receipt = await enqueue.mutateAsync({
        params: { agent_id: agentId, task_id: taskId },
        body: { input_id: attempt.inputId, text: trimmed },
      })
      setTextByInputId((current) => ({ ...current, [receipt.input_id]: trimmed }))
      retryRef.current = null
      setSendError(null)
      void query.refetch()
      return true
    } catch {
      retryRef.current = attempt
      setSendError({ taskId })
      return false
    } finally {
      inflightRef.current = false
    }
  }

  return { entries, canSteer, sendFailed, textByInputId, steer }
}
