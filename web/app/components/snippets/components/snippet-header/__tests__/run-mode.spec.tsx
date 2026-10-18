import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  baseRunningData,
  renderWorkflowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider as EventEmitterProvider } from '@/context/event-emitter-provider'
import RunMode from '../run-mode'

const workflowHookMocks = vi.hoisted(() => ({
  handleWorkflowStartRunInWorkflow: vi.fn(),
  handleStopRun: vi.fn(),
}))

let emit: NonNullable<ReturnType<typeof useEventEmitterContextContext>['eventEmitter']>['emit']
const EventSource = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  emit = (event) => eventEmitter?.emit(event)
  return null
}
const renderRunMode = (text?: string, workflowRunningData?: ReturnType<typeof baseRunningData>) =>
  renderWorkflowComponent(
    <EventEmitterProvider>
      <EventSource />
      <RunMode text={text} />
    </EventEmitterProvider>,
    { initialStoreState: { workflowRunningData } },
  )

vi.mock('@/app/components/workflow/hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({
    handleStopRun: workflowHookMocks.handleStopRun,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-start-run', () => ({
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInWorkflow: workflowHookMocks.handleWorkflowStartRunInWorkflow,
  }),
}))

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should start a snippet test run when idle', async () => {
    const user = userEvent.setup()

    renderRunMode('Run snippet')
    act(() => {
      emit({ type: 'unrelated-event' })
      emit('plain-message')
    })

    await user.click(screen.getByRole('button', { name: /Run snippet/i }))

    expect(workflowHookMocks.handleWorkflowStartRunInWorkflow).toHaveBeenCalledTimes(1)
    expect(workflowHookMocks.handleStopRun).not.toHaveBeenCalled()
  })

  it('should stop the running workflow from the stop button and workflow stop event', async () => {
    const user = userEvent.setup()

    renderRunMode(undefined, baseRunningData())

    expect(screen.getByRole('button', { name: /workflow\.common\.running/i })).toBeDisabled()

    await user.click(
      screen.getByRole('button', { name: /workflowDebug\.debug\.variableInspect\.trigger\.stop/i }),
    )

    expect(workflowHookMocks.handleStopRun).toHaveBeenCalledWith('task-1')

    act(() => emit({ type: EVENT_WORKFLOW_STOP }))

    expect(workflowHookMocks.handleStopRun).toHaveBeenCalledTimes(2)
  })

  it('should stop with an empty task id when running data has no task id', async () => {
    const user = userEvent.setup()

    renderRunMode(undefined, baseRunningData({ task_id: undefined }))

    await user.click(
      screen.getByRole('button', { name: /workflowDebug\.debug\.variableInspect\.trigger\.stop/i }),
    )

    expect(workflowHookMocks.handleStopRun).toHaveBeenCalledWith('')
  })
})
