import {
  useWorkflowAgentLog,
  useWorkflowFailed,
  useWorkflowFinished,
  useWorkflowNodeFinished,
  useWorkflowNodeHumanInputFormFilled,
  useWorkflowNodeHumanInputFormTimeout,
  useWorkflowNodeHumanInputRequired,
  useWorkflowNodeIterationFinished,
  useWorkflowNodeIterationNext,
  useWorkflowNodeIterationStarted,
  useWorkflowNodeLoopFinished,
  useWorkflowNodeLoopNext,
  useWorkflowNodeLoopStarted,
  useWorkflowNodeRetry,
  useWorkflowNodeStarted,
  useWorkflowPaused,
  useWorkflowStarted,
  useWorkflowTextChunk,
  useWorkflowTextReplace,
} from '.'
import { useWorkflowReasoning } from './use-workflow-reasoning'

export const useWorkflowRunEvent = () => {
  const { handleWorkflowStarted } = useWorkflowStarted()
  const { handleWorkflowFinished } = useWorkflowFinished()
  const { handleWorkflowFailed } = useWorkflowFailed()
  const { handleWorkflowNodeStarted } = useWorkflowNodeStarted()
  const { handleWorkflowNodeFinished } = useWorkflowNodeFinished()
  const { handleWorkflowNodeIterationStarted } = useWorkflowNodeIterationStarted()
  const { handleWorkflowNodeIterationNext } = useWorkflowNodeIterationNext()
  const { handleWorkflowNodeIterationFinished } = useWorkflowNodeIterationFinished()
  const { handleWorkflowNodeLoopStarted } = useWorkflowNodeLoopStarted()
  const { handleWorkflowNodeLoopNext } = useWorkflowNodeLoopNext()
  const { handleWorkflowNodeLoopFinished } = useWorkflowNodeLoopFinished()
  const { handleWorkflowNodeRetry } = useWorkflowNodeRetry()
  const { handleWorkflowTextChunk } = useWorkflowTextChunk()
  const { handleWorkflowTextReplace } = useWorkflowTextReplace()
  const { handleWorkflowReasoning } = useWorkflowReasoning()
  const { handleWorkflowAgentLog } = useWorkflowAgentLog()
  const { handleWorkflowPaused } = useWorkflowPaused()
  const { handleWorkflowNodeHumanInputRequired } = useWorkflowNodeHumanInputRequired()
  const { handleWorkflowNodeHumanInputFormFilled } = useWorkflowNodeHumanInputFormFilled()
  const { handleWorkflowNodeHumanInputFormTimeout } = useWorkflowNodeHumanInputFormTimeout()

  return {
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeLoopStarted,
    handleWorkflowNodeLoopNext,
    handleWorkflowNodeLoopFinished,
    handleWorkflowNodeRetry,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
    handleWorkflowReasoning,
    handleWorkflowAgentLog,
    handleWorkflowPaused,
    handleWorkflowNodeHumanInputFormFilled,
    handleWorkflowNodeHumanInputRequired,
    handleWorkflowNodeHumanInputFormTimeout,
  }
}
