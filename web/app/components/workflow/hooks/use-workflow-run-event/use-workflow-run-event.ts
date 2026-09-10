import { useWorkflowAgentLog } from './use-workflow-agent-log'
import { useWorkflowFailed } from './use-workflow-failed'
import { useWorkflowFinished } from './use-workflow-finished'
import { useWorkflowNodeFinished } from './use-workflow-node-finished'
import { useWorkflowNodeHumanInputFormFilled } from './use-workflow-node-human-input-form-filled'
import { useWorkflowNodeHumanInputFormTimeout } from './use-workflow-node-human-input-form-timeout'
import { useWorkflowNodeHumanInputRequired } from './use-workflow-node-human-input-required'
import { useWorkflowNodeIterationFinished } from './use-workflow-node-iteration-finished'
import { useWorkflowNodeIterationNext } from './use-workflow-node-iteration-next'
import { useWorkflowNodeIterationStarted } from './use-workflow-node-iteration-started'
import { useWorkflowNodeLoopFinished } from './use-workflow-node-loop-finished'
import { useWorkflowNodeLoopNext } from './use-workflow-node-loop-next'
import { useWorkflowNodeLoopStarted } from './use-workflow-node-loop-started'
import { useWorkflowNodeRetry } from './use-workflow-node-retry'
import { useWorkflowNodeStarted } from './use-workflow-node-started'
import { useWorkflowPaused } from './use-workflow-paused'
import { useWorkflowReasoning } from './use-workflow-reasoning'
import { useWorkflowStarted } from './use-workflow-started'
import { useWorkflowTextChunk } from './use-workflow-text-chunk'
import { useWorkflowTextReplace } from './use-workflow-text-replace'

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
