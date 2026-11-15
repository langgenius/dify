import type { ResultRunStateController } from './use-result-run-state'
import { useCallback, useEffect, useRef } from 'react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { createWorkflowEventsSubscription } from '../workflow-events-subscription'
import {
  applyWorkflowFinishedState,
  createWorkflowStreamHandlers,
} from '../workflow-stream-handlers'

export const useWebAppWorkflowEvents = ({
  abortControllerRef,
  isResponding,
}: Pick<ResultRunStateController, 'abortControllerRef' | 'isResponding'>) => {
  const subscriptionRef = useRef<ReturnType<typeof createWorkflowEventsSubscription> | null>(null)

  useEffect(() => {
    if (!isResponding) subscriptionRef.current?.dispose()
  }, [isResponding])
  useEffect(() => () => subscriptionRef.current?.dispose(), [])

  const reset = useCallback(() => {
    subscriptionRef.current?.dispose()
    subscriptionRef.current = null
  }, [])
  const prepareHumanInputSubmission = useCallback(
    () => subscriptionRef.current?.prepare() ?? Promise.resolve(true),
    [],
  )

  const createStreamHandlers = useCallback(
    (options: Parameters<typeof createWorkflowStreamHandlers>[0]) => {
      const subscription = createWorkflowEventsSubscription({
        onAbort: () => {
          options.markEnded()
          options.setWorkflowProcessData({
            ...applyWorkflowFinishedState(
              options.getWorkflowProcessData(),
              WorkflowRunningStatus.Stopped,
            ),
            humanInputFormDataList: [],
          })
          options.setRespondingFalse()
          options.resetRunState()
          options.onCompleted(options.getCompletionRes(), options.taskId, false)
        },
      })
      subscriptionRef.current = subscription
      const handlers = createWorkflowStreamHandlers({
        ...options,
        onPaused: (runId, streamHandlers) => {
          options.markEnded()
          subscription.start(runId, {
            ...streamHandlers,
            getAbortController: (controller) => {
              abortControllerRef.current = controller
            },
          })
        },
      })
      const onWorkflowFinished = handlers.onWorkflowFinished
      handlers.onWorkflowFinished = (event) => {
        const current = options.getWorkflowProcessData()
        if (current) options.setWorkflowProcessData({ ...current, humanInputFormDataList: [] })
        onWorkflowFinished?.(event)
      }
      return handlers
    },
    [abortControllerRef],
  )

  return { createStreamHandlers, prepareHumanInputSubmission, reset }
}
