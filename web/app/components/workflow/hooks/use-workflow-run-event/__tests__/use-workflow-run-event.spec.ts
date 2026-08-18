import { renderHook } from '@testing-library/react'
import { useWorkflowRunEvent } from '../use-workflow-run-event'

const handlers = vi.hoisted(() => ({
  handleWorkflowStarted: vi.fn(),
  handleWorkflowFinished: vi.fn(),
  handleWorkflowFailed: vi.fn(),
  handleWorkflowNodeStarted: vi.fn(),
  handleWorkflowNodeFinished: vi.fn(),
  handleWorkflowNodeIterationStarted: vi.fn(),
  handleWorkflowNodeIterationNext: vi.fn(),
  handleWorkflowNodeIterationFinished: vi.fn(),
  handleWorkflowNodeLoopStarted: vi.fn(),
  handleWorkflowNodeLoopNext: vi.fn(),
  handleWorkflowNodeLoopFinished: vi.fn(),
  handleWorkflowNodeRetry: vi.fn(),
  handleWorkflowTextChunk: vi.fn(),
  handleWorkflowTextReplace: vi.fn(),
  handleWorkflowReasoning: vi.fn(),
  handleWorkflowAgentLog: vi.fn(),
  handleWorkflowPaused: vi.fn(),
  handleWorkflowNodeHumanInputRequired: vi.fn(),
  handleWorkflowNodeHumanInputFormFilled: vi.fn(),
  handleWorkflowNodeHumanInputFormTimeout: vi.fn(),
}))

vi.mock('../use-workflow-started', () => ({
  useWorkflowStarted: () => ({ handleWorkflowStarted: handlers.handleWorkflowStarted }),
}))
vi.mock('../use-workflow-finished', () => ({
  useWorkflowFinished: () => ({ handleWorkflowFinished: handlers.handleWorkflowFinished }),
}))
vi.mock('../use-workflow-failed', () => ({
  useWorkflowFailed: () => ({ handleWorkflowFailed: handlers.handleWorkflowFailed }),
}))
vi.mock('../use-workflow-node-started', () => ({
  useWorkflowNodeStarted: () => ({ handleWorkflowNodeStarted: handlers.handleWorkflowNodeStarted }),
}))
vi.mock('../use-workflow-node-finished', () => ({
  useWorkflowNodeFinished: () => ({
    handleWorkflowNodeFinished: handlers.handleWorkflowNodeFinished,
  }),
}))
vi.mock('../use-workflow-node-iteration-started', () => ({
  useWorkflowNodeIterationStarted: () => ({
    handleWorkflowNodeIterationStarted: handlers.handleWorkflowNodeIterationStarted,
  }),
}))
vi.mock('../use-workflow-node-iteration-next', () => ({
  useWorkflowNodeIterationNext: () => ({
    handleWorkflowNodeIterationNext: handlers.handleWorkflowNodeIterationNext,
  }),
}))
vi.mock('../use-workflow-node-iteration-finished', () => ({
  useWorkflowNodeIterationFinished: () => ({
    handleWorkflowNodeIterationFinished: handlers.handleWorkflowNodeIterationFinished,
  }),
}))
vi.mock('../use-workflow-node-loop-started', () => ({
  useWorkflowNodeLoopStarted: () => ({
    handleWorkflowNodeLoopStarted: handlers.handleWorkflowNodeLoopStarted,
  }),
}))
vi.mock('../use-workflow-node-loop-next', () => ({
  useWorkflowNodeLoopNext: () => ({
    handleWorkflowNodeLoopNext: handlers.handleWorkflowNodeLoopNext,
  }),
}))
vi.mock('../use-workflow-node-loop-finished', () => ({
  useWorkflowNodeLoopFinished: () => ({
    handleWorkflowNodeLoopFinished: handlers.handleWorkflowNodeLoopFinished,
  }),
}))
vi.mock('../use-workflow-node-retry', () => ({
  useWorkflowNodeRetry: () => ({ handleWorkflowNodeRetry: handlers.handleWorkflowNodeRetry }),
}))
vi.mock('../use-workflow-text-chunk', () => ({
  useWorkflowTextChunk: () => ({ handleWorkflowTextChunk: handlers.handleWorkflowTextChunk }),
}))
vi.mock('../use-workflow-text-replace', () => ({
  useWorkflowTextReplace: () => ({ handleWorkflowTextReplace: handlers.handleWorkflowTextReplace }),
}))
vi.mock('../use-workflow-agent-log', () => ({
  useWorkflowAgentLog: () => ({ handleWorkflowAgentLog: handlers.handleWorkflowAgentLog }),
}))
vi.mock('../use-workflow-paused', () => ({
  useWorkflowPaused: () => ({ handleWorkflowPaused: handlers.handleWorkflowPaused }),
}))
vi.mock('../use-workflow-node-human-input-required', () => ({
  useWorkflowNodeHumanInputRequired: () => ({
    handleWorkflowNodeHumanInputRequired: handlers.handleWorkflowNodeHumanInputRequired,
  }),
}))
vi.mock('../use-workflow-node-human-input-form-filled', () => ({
  useWorkflowNodeHumanInputFormFilled: () => ({
    handleWorkflowNodeHumanInputFormFilled: handlers.handleWorkflowNodeHumanInputFormFilled,
  }),
}))
vi.mock('../use-workflow-node-human-input-form-timeout', () => ({
  useWorkflowNodeHumanInputFormTimeout: () => ({
    handleWorkflowNodeHumanInputFormTimeout: handlers.handleWorkflowNodeHumanInputFormTimeout,
  }),
}))

vi.mock('../use-workflow-reasoning', () => ({
  useWorkflowReasoning: () => ({ handleWorkflowReasoning: handlers.handleWorkflowReasoning }),
}))

describe('useWorkflowRunEvent', () => {
  it('returns the composed handlers from all workflow event hooks', () => {
    const { result } = renderHook(() => useWorkflowRunEvent())

    expect(result.current).toEqual(handlers)
  })
})
