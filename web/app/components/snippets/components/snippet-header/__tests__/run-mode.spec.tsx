import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import RunMode from '../run-mode'

const workflowHookMocks = vi.hoisted(() => ({
  handleWorkflowStartRunInWorkflow: vi.fn(),
  handleStopRun: vi.fn(),
}))

const eventEmitterState = vi.hoisted(() => ({
  subscription: null as null | ((payload: unknown) => void),
}))

const runningResult = {
  status: WorkflowRunningStatus.Running,
  inputs_truncated: false,
  process_data_truncated: false,
  outputs_truncated: false,
}

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInWorkflow: workflowHookMocks.handleWorkflowStartRunInWorkflow,
  }),
  useWorkflowRun: () => ({
    handleStopRun: workflowHookMocks.handleStopRun,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (handler: (payload: unknown) => void) => {
        eventEmitterState.subscription = handler
      },
    },
  }),
}))

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventEmitterState.subscription = null
  })

  it('should start a snippet test run when idle', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<RunMode text="Run snippet" />)

    await user.click(screen.getByRole('button', { name: /Run snippet/i }))

    expect(workflowHookMocks.handleWorkflowStartRunInWorkflow).toHaveBeenCalledTimes(1)
    expect(workflowHookMocks.handleStopRun).not.toHaveBeenCalled()
  })

  it('should stop the running workflow from the stop button and workflow stop event', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<RunMode />, {
      initialStoreState: {
        workflowRunningData: {
          task_id: 'task-1',
          result: runningResult,
        },
      },
    })

    expect(screen.getByRole('button', { name: /workflow\.common\.running/i })).toBeDisabled()

    await user.click(screen.getAllByRole('button')[1]!)

    expect(workflowHookMocks.handleStopRun).toHaveBeenCalledWith('task-1')

    eventEmitterState.subscription?.({ type: EVENT_WORKFLOW_STOP })

    expect(workflowHookMocks.handleStopRun).toHaveBeenCalledTimes(2)
  })

  it('should use the default run label and ignore unrelated workflow events while idle', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<RunMode />)

    expect(screen.getByRole('button', { name: /workflow\.common\.run/i })).toBeInTheDocument()

    eventEmitterState.subscription?.({ type: 'unrelated-event' })
    eventEmitterState.subscription?.('plain-message')
    await user.click(screen.getByRole('button', { name: /workflow\.common\.run/i }))

    expect(workflowHookMocks.handleStopRun).not.toHaveBeenCalled()
    expect(workflowHookMocks.handleWorkflowStartRunInWorkflow).toHaveBeenCalledTimes(1)
  })

  it('should stop with an empty task id when running data has no task id', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(<RunMode />, {
      initialStoreState: {
        workflowRunningData: {
          result: runningResult,
        },
      },
    })

    await user.click(screen.getAllByRole('button')[1]!)

    expect(workflowHookMocks.handleStopRun).toHaveBeenCalledWith('')
  })
})
