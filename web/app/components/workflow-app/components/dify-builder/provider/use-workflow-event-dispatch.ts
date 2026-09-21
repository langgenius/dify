import type { DifyBuilderWorkflowEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowRunEvent } from '@/app/components/workflow/hooks/use-workflow-run-event/use-workflow-run-event'

// The shared handlers still type stream records as complete NodeTracing rows.
// Adapt those legacy types at this boundary; the native payload stays unchanged.
export const useWorkflowEventDispatch = () => {
  const canvas = useStoreApi()
  const {
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeRetry,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeLoopStarted,
    handleWorkflowNodeLoopNext,
    handleWorkflowNodeLoopFinished,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
    handleWorkflowReasoning,
    handleWorkflowAgentLog,
    handleWorkflowNodeHumanInputRequired,
    handleWorkflowNodeHumanInputFormFilled,
    handleWorkflowNodeHumanInputFormTimeout,
    handleWorkflowPaused,
    handleWorkflowFailed,
  } = useWorkflowRunEvent()

  return useCallback(
    (payload: DifyBuilderWorkflowEventData['payload']) => {
      const { width: clientWidth, height: clientHeight } = canvas.getState()
      const container = { clientWidth, clientHeight }
      switch (payload.event) {
        case 'workflow_started':
          handleWorkflowStarted(payload as Parameters<typeof handleWorkflowStarted>[0])
          break
        case 'workflow_finished':
          handleWorkflowFinished(payload as Parameters<typeof handleWorkflowFinished>[0])
          break
        case 'node_started':
          handleWorkflowNodeStarted(
            payload as Parameters<typeof handleWorkflowNodeStarted>[0],
            container,
          )
          break
        case 'node_finished':
          handleWorkflowNodeFinished(payload as Parameters<typeof handleWorkflowNodeFinished>[0])
          break
        case 'node_retry':
          handleWorkflowNodeRetry(payload as Parameters<typeof handleWorkflowNodeRetry>[0])
          break
        case 'iteration_started':
          handleWorkflowNodeIterationStarted(
            payload as Parameters<typeof handleWorkflowNodeIterationStarted>[0],
            container,
          )
          break
        case 'iteration_next':
          handleWorkflowNodeIterationNext(
            payload as Parameters<typeof handleWorkflowNodeIterationNext>[0],
          )
          break
        case 'iteration_completed':
          handleWorkflowNodeIterationFinished(
            payload as unknown as Parameters<typeof handleWorkflowNodeIterationFinished>[0],
          )
          break
        case 'loop_started':
          handleWorkflowNodeLoopStarted(
            payload as Parameters<typeof handleWorkflowNodeLoopStarted>[0],
            container,
          )
          break
        case 'loop_next':
          handleWorkflowNodeLoopNext(payload as Parameters<typeof handleWorkflowNodeLoopNext>[0])
          break
        case 'loop_completed':
          handleWorkflowNodeLoopFinished(
            payload as unknown as Parameters<typeof handleWorkflowNodeLoopFinished>[0],
          )
          break
        case 'text_chunk':
        case 'message':
          handleWorkflowTextChunk(payload as Parameters<typeof handleWorkflowTextChunk>[0])
          break
        case 'text_replace':
        case 'message_replace':
          handleWorkflowTextReplace(payload as Parameters<typeof handleWorkflowTextReplace>[0])
          break
        case 'reasoning_chunk':
          handleWorkflowReasoning(payload as Parameters<typeof handleWorkflowReasoning>[0])
          break
        case 'agent_log':
          handleWorkflowAgentLog(payload as unknown as Parameters<typeof handleWorkflowAgentLog>[0])
          break
        case 'human_input_required':
          handleWorkflowNodeHumanInputRequired(
            payload as Parameters<typeof handleWorkflowNodeHumanInputRequired>[0],
          )
          break
        case 'human_input_form_filled':
          handleWorkflowNodeHumanInputFormFilled(
            payload as Parameters<typeof handleWorkflowNodeHumanInputFormFilled>[0],
          )
          break
        case 'human_input_form_timeout':
          handleWorkflowNodeHumanInputFormTimeout(
            payload as Parameters<typeof handleWorkflowNodeHumanInputFormTimeout>[0],
          )
          break
        case 'workflow_paused':
          handleWorkflowPaused()
          break
        case 'error':
          handleWorkflowFailed(payload.message)
          break
        case 'tts_message':
        case 'tts_message_end':
        case 'message_end':
        case 'message_file':
          // The workflow run panel renders files and metrics from node/run
          // callbacks; chat message metadata and audio need no extra projection.
          break
        default:
          payload satisfies never
      }
    },
    [
      canvas,
      handleWorkflowStarted,
      handleWorkflowFinished,
      handleWorkflowNodeStarted,
      handleWorkflowNodeFinished,
      handleWorkflowNodeRetry,
      handleWorkflowNodeIterationStarted,
      handleWorkflowNodeIterationNext,
      handleWorkflowNodeIterationFinished,
      handleWorkflowNodeLoopStarted,
      handleWorkflowNodeLoopNext,
      handleWorkflowNodeLoopFinished,
      handleWorkflowTextChunk,
      handleWorkflowTextReplace,
      handleWorkflowReasoning,
      handleWorkflowAgentLog,
      handleWorkflowNodeHumanInputRequired,
      handleWorkflowNodeHumanInputFormFilled,
      handleWorkflowNodeHumanInputFormTimeout,
      handleWorkflowPaused,
      handleWorkflowFailed,
    ],
  )
}
