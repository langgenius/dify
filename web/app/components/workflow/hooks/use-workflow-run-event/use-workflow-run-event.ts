import {
  useWorkflowAgentLog,
  useWorkflowFailed,
  useWorkflowFinished,
  useWorkflowNodeFinished,
  useWorkflowNodeIterationFinished,
  useWorkflowNodeIterationNext,
  useWorkflowNodeIterationStarted,
  useWorkflowNodeRetry,
  useWorkflowNodeStarted,
  useWorkflowStarted,
  useWorkflowTextChunk,
  useWorkflowTextReplace,
} from '.'

export const useWorkflowRunEvent = () => {
  const { handleWorkflowStarted } = useWorkflowStarted()
  const { handleWorkflowFinished } = useWorkflowFinished()
  const { handleWorkflowFailed } = useWorkflowFailed()
  const { handleWorkflowNodeStarted } = useWorkflowNodeStarted()
  const { handleWorkflowNodeFinished } = useWorkflowNodeFinished()
  const { handleWorkflowNodeIterationStarted } = useWorkflowNodeIterationStarted()
  const { handleWorkflowNodeIterationNext } = useWorkflowNodeIterationNext()
  const { handleWorkflowNodeIterationFinished } = useWorkflowNodeIterationFinished()
  const { handleWorkflowNodeRetry } = useWorkflowNodeRetry()
  const { handleWorkflowTextChunk } = useWorkflowTextChunk()
  const { handleWorkflowTextReplace } = useWorkflowTextReplace()
  const { handleWorkflowAgentLog } = useWorkflowAgentLog()

  return {
    handleWorkflowStarted,
    handleWorkflowFinished,
    handleWorkflowFailed,
    handleWorkflowNodeStarted,
    handleWorkflowNodeFinished,
    handleWorkflowNodeIterationStarted,
    handleWorkflowNodeIterationNext,
    handleWorkflowNodeIterationFinished,
    handleWorkflowNodeRetry,
    handleWorkflowTextChunk,
    handleWorkflowTextReplace,
    handleWorkflowAgentLog,
  }
}
