import {
  useWorkflowAgentLog,
  useWorkflowFailed,
  useWorkflowFinished,
  useWorkflowNodeFinished,
  useWorkflowNodeHumanInputFormFilled,
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
import { useWorkflowResume } from './use-workflow-resume'

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
  const { handleWorkflowAgentLog } = useWorkflowAgentLog()
  const { handleWorkflowPaused } = useWorkflowPaused()
  const { handleWorkflowNodeHumanInputRequired } = useWorkflowNodeHumanInputRequired()
  const { handleWorkflowNodeHumanInputFormFilled } = useWorkflowNodeHumanInputFormFilled()
  const { handleWorkflowResume } = useWorkflowResume()

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
    handleWorkflowAgentLog,
    handleWorkflowPaused,
    handleWorkflowNodeHumanInputFormFilled,
    handleWorkflowNodeHumanInputRequired,
    handleWorkflowResume,
  }
}
