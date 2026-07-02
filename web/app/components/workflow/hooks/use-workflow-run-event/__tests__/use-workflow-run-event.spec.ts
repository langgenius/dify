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
  handleWorkflowAgentLog: vi.fn(),
  handleWorkflowPaused: vi.fn(),
  handleWorkflowNodeHumanInputRequired: vi.fn(),
  handleWorkflowNodeHumanInputFormFilled: vi.fn(),
  handleWorkflowNodeHumanInputFormTimeout: vi.fn(),
}))

vi.mock('..', () => ({
  useWorkflowStarted: () => ({ handleWorkflowStarted: handlers.handleWorkflowStarted }),
  useWorkflowFinished: () => ({ handleWorkflowFinished: handlers.handleWorkflowFinished }),
  useWorkflowFailed: () => ({ handleWorkflowFailed: handlers.handleWorkflowFailed }),
  useWorkflowNodeStarted: () => ({ handleWorkflowNodeStarted: handlers.handleWorkflowNodeStarted }),
  useWorkflowNodeFinished: () => ({ handleWorkflowNodeFinished: handlers.handleWorkflowNodeFinished }),
  useWorkflowNodeIterationStarted: () => ({ handleWorkflowNodeIterationStarted: handlers.handleWorkflowNodeIterationStarted }),
  useWorkflowNodeIterationNext: () => ({ handleWorkflowNodeIterationNext: handlers.handleWorkflowNodeIterationNext }),
  useWorkflowNodeIterationFinished: () => ({ handleWorkflowNodeIterationFinished: handlers.handleWorkflowNodeIterationFinished }),
  useWorkflowNodeLoopStarted: () => ({ handleWorkflowNodeLoopStarted: handlers.handleWorkflowNodeLoopStarted }),
  useWorkflowNodeLoopNext: () => ({ handleWorkflowNodeLoopNext: handlers.handleWorkflowNodeLoopNext }),
  useWorkflowNodeLoopFinished: () => ({ handleWorkflowNodeLoopFinished: handlers.handleWorkflowNodeLoopFinished }),
  useWorkflowNodeRetry: () => ({ handleWorkflowNodeRetry: handlers.handleWorkflowNodeRetry }),
  useWorkflowTextChunk: () => ({ handleWorkflowTextChunk: handlers.handleWorkflowTextChunk }),
  useWorkflowTextReplace: () => ({ handleWorkflowTextReplace: handlers.handleWorkflowTextReplace }),
  useWorkflowAgentLog: () => ({ handleWorkflowAgentLog: handlers.handleWorkflowAgentLog }),
  useWorkflowPaused: () => ({ handleWorkflowPaused: handlers.handleWorkflowPaused }),
  useWorkflowNodeHumanInputRequired: () => ({ handleWorkflowNodeHumanInputRequired: handlers.handleWorkflowNodeHumanInputRequired }),
  useWorkflowNodeHumanInputFormFilled: () => ({ handleWorkflowNodeHumanInputFormFilled: handlers.handleWorkflowNodeHumanInputFormFilled }),
  useWorkflowNodeHumanInputFormTimeout: () => ({ handleWorkflowNodeHumanInputFormTimeout: handlers.handleWorkflowNodeHumanInputFormTimeout }),
}))

describe('useWorkflowRunEvent', () => {
  it('returns the composed handlers from all workflow event hooks', () => {
    const { result } = renderHook(() => useWorkflowRunEvent())

    expect(result.current).toEqual(handlers)
  })
})
