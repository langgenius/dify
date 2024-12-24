import { 
  useWorkflowStarted,
  useWorkflowFinished,
  useWorkflowFailed,
  useWorkflowNodeStarted,
  useWorkflowNodeFinished,
  useWorkflowNodeIterationStarted,
  useWorkflowNodeIterationNext,
  useWorkflowNodeIterationFinished,
  useWorkflowNodeRetry,
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
  }
}