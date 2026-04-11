import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useWorkflowStartRun } from '../use-workflow-start-run'

describe('useWorkflowStartRun', () => {
  it('returns start-run handlers from hooks store', () => {
    const handlers = {
      handleStartWorkflowRun: vi.fn(),
      handleWorkflowStartRunInWorkflow: vi.fn(),
      handleWorkflowStartRunInChatflow: vi.fn(),
      handleWorkflowTriggerScheduleRunInWorkflow: vi.fn(),
      handleWorkflowTriggerWebhookRunInWorkflow: vi.fn(),
      handleWorkflowTriggerPluginRunInWorkflow: vi.fn(),
      handleWorkflowRunAllTriggersInWorkflow: vi.fn(),
    }

    const { result } = renderWorkflowHook(() => useWorkflowStartRun(), {
      hooksStoreProps: handlers,
    })

    expect(result.current.handleStartWorkflowRun).toBe(handlers.handleStartWorkflowRun)
    expect(result.current.handleWorkflowStartRunInWorkflow).toBe(handlers.handleWorkflowStartRunInWorkflow)
    expect(result.current.handleWorkflowStartRunInChatflow).toBe(handlers.handleWorkflowStartRunInChatflow)
    expect(result.current.handleWorkflowTriggerScheduleRunInWorkflow).toBe(handlers.handleWorkflowTriggerScheduleRunInWorkflow)
    expect(result.current.handleWorkflowTriggerWebhookRunInWorkflow).toBe(handlers.handleWorkflowTriggerWebhookRunInWorkflow)
    expect(result.current.handleWorkflowTriggerPluginRunInWorkflow).toBe(handlers.handleWorkflowTriggerPluginRunInWorkflow)
    expect(result.current.handleWorkflowRunAllTriggersInWorkflow).toBe(handlers.handleWorkflowRunAllTriggersInWorkflow)
  })
})
